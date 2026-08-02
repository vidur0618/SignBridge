import { randomUUID } from "node:crypto";
import {
  AccessCodeExchangeRequestSchema,
  AccessCodeExchangeResponseSchema,
  AdminMetricsResponseSchema,
  AudioTranscriptionResponseSchema,
  CatalogPublicResponseSchema,
  DecisionRequestSchema,
  DecisionResponseSchema,
  FeedbackRequestSchema,
  FeedbackResponseSchema,
  RECEPTION_INTENTS,
  UNSUPPORTED_REASON_CODES,
  createRenderSegment,
  createSignPlan,
  isAssetRevoked,
  type AudioSession,
  type ReceptionIntentId,
  type UnsupportedReasonCode,
} from "@signbridge/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "./app.js";
import { inspectAudioDurationMs } from "./audio-duration.js";
import { AssetUnavailableError } from "./adapters/assets.js";
import { ProviderUnavailableError } from "./adapters/speech.js";
import { authenticateInternalRequest } from "./internal-auth.js";
import { TranscriptionFallbackError } from "./transcription-service.js";
import {
  clearSessionCookie,
  createSession,
  requireAdmin,
  requireSite,
  resolveRole,
  setSessionCookie,
} from "./security.js";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const PlaybackEventSchema = z
  .object({
    utteranceId: z.uuid(),
    assetId: z.string().min(1).max(120),
    result: z.enum(["started", "completed", "failed"]),
  })
  .strict();

export async function registerRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const {
    config,
    catalog,
    assetSigner,
    pendingDecisions,
    playbackGrants,
    revocations,
    events,
    transcription,
  } = dependencies;

  app.get("/api/health", async () => ({
    status: "ok",
    mode: config.useGoogleCloud ? "google-cloud" : "local-safe",
    service: config.serviceName ?? null,
    revision: config.serviceRevision ?? null,
    deploymentSha: config.deploymentSha ?? null,
    configuredModels: {
      speech: config.useGoogleCloud ? config.googleSpeechModel : null,
      classifier: config.useGoogleCloud ? config.geminiModel : null,
    },
    catalogVersion: catalog.current().catalogVersion,
    playbackEnabled: catalog.current().playbackEnabled,
  }));

  app.post(
    "/api/session/exchange",
    { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const parsed = AccessCodeExchangeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_session_request" });
      }
      const role = resolveRole(parsed.data.accessCode, config);
      if (!role) return reply.code(401).send({ error: "invalid_access_code" });
      const session = createSession(role, parsed.data.consentVersion, config);
      setSessionCookie(reply, session, config);
      await events.record({
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        siteId: session.siteId,
        sessionId: session.sessionId,
        type: "session_started",
      });
      return AccessCodeExchangeResponseSchema.parse({
        authenticated: true,
        sessionId: session.sessionId,
        siteId: session.siteId,
        expiresAt: session.expiresAt,
      });
    },
  );

  app.delete("/api/session", async (_request, reply) => {
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });

  app.get("/api/catalog", { preHandler: requireSite }, async () => {
    const current = catalog.current();
    return CatalogPublicResponseSchema.parse({
      catalogVersion: current.catalogVersion,
      status: current.status,
      languagePack: current.languagePack,
      playbackEnabled: current.playbackEnabled,
      intents: RECEPTION_INTENTS.map((intent) => ({
        ...intent,
        available:
          current.intents.find((entry) => entry.id === intent.id)?.playbackEnabled === true &&
          catalog.assetForIntent(intent.id) !== null,
      })),
    });
  });

  app.post("/api/audio/transcribe", { preHandler: requireSite }, async (request, reply) => {
    const auth = request.authSession;
    if (!auth) return reply.code(401).send({ error: "authentication_required" });
    let part;
    try {
      part = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    } catch {
      return reply.code(413).send({ error: "audio_too_large" });
    }
    if (!part || part.fieldname !== "audio") {
      return reply.code(400).send({ error: "audio_file_required" });
    }
    const mimeType = normalizeMimeType(part.mimetype);
    if (!mimeType) return reply.code(415).send({ error: "unsupported_audio_type" });
    let bytes: Buffer;
    try {
      bytes = await part.toBuffer();
    } catch {
      return reply.code(413).send({ error: "audio_too_large" });
    }
    if (bytes.length === 0) return reply.code(400).send({ error: "invalid_audio" });
    const encoding = mimeType === "audio/wav" ? "WAV" : mimeType === "audio/mpeg" ? "MP3" : "WEBM_OPUS";
    const session = transcription.createAudioSession(auth, "upload", "finalizing", encoding);
    const startedAt = Date.now();
    let speechSegments;
    try {
      const verifiedDurationMs = inspectAudioDurationMs(bytes, mimeType);
      if (verifiedDurationMs == null) {
        await recordTranscriptionTerminal(dependencies, auth.siteId, auth.sessionId, "upload", {
          fallbackReason: "invalid_audio",
          latencyMs: Date.now() - startedAt,
        });
        return reply.code(422).send(
          AudioTranscriptionResponseSchema.parse({
            session: completeSession(session, "failed"),
            segments: [],
            stableUtterances: [],
            detectedIntents: [],
            fallbackReason: "invalid_audio",
          }),
        );
      }
      if (verifiedDurationMs > 60_000) {
        await recordTranscriptionTerminal(dependencies, auth.siteId, auth.sessionId, "upload", {
          fallbackReason: "audio_too_long",
          latencyMs: Date.now() - startedAt,
        });
        return reply.code(413).send(
          AudioTranscriptionResponseSchema.parse({
            session: completeSession(session, "failed"),
            segments: [],
            stableUtterances: [],
            detectedIntents: [],
            fallbackReason: "audio_too_long",
          }),
        );
      }
      speechSegments = await transcription.speech.transcribeUpload({
        bytes,
        mimeType,
        locale: "en-US",
      });
    } catch (error) {
      const unavailable = error instanceof ProviderUnavailableError;
      request.log.warn({ provider: transcription.speech.providerName }, "audio transcription failed");
      await recordTranscriptionTerminal(dependencies, auth.siteId, auth.sessionId, "upload", {
        fallbackReason: "invalid_audio",
        latencyMs: Date.now() - startedAt,
      });
      return reply.code(unavailable ? 503 : 422).send(
        AudioTranscriptionResponseSchema.parse({
          session: completeSession(session, "failed"),
          segments: [],
          stableUtterances: [],
          detectedIntents: [],
          fallbackReason: "invalid_audio",
        }),
      );
    } finally {
      bytes.fill(0);
    }

    const segments = speechSegments
      .filter((segment) => segment.isFinal)
      .map((segment, index) => transcription.toTranscriptSegment(session.id, index, segment));
    if (segments.some((segment) => segment.endMs > 60_000)) {
      await recordTranscriptionTerminal(dependencies, auth.siteId, auth.sessionId, "upload", {
        fallbackReason: "audio_too_long",
        latencyMs: Date.now() - startedAt,
      });
      return reply.code(413).send(
        AudioTranscriptionResponseSchema.parse({
          session: completeSession(session, "failed"),
          segments: [],
          stableUtterances: [],
          detectedIntents: [],
          fallbackReason: "audio_too_long",
        }),
      );
    }
    if (segments.length === 0) {
      await recordTranscriptionTerminal(dependencies, auth.siteId, auth.sessionId, "upload", {
        fallbackReason: "no_final_transcript",
        latencyMs: Date.now() - startedAt,
      });
      return AudioTranscriptionResponseSchema.parse({
        session: completeSession(session, "failed"),
        segments: [],
        stableUtterances: [],
        detectedIntents: [],
        fallbackReason: "no_final_transcript",
      });
    }

    try {
      const bundle = await transcription.classifyFinalSegments(auth, session, segments, "upload");
      await recordTranscriptionTerminal(dependencies, auth.siteId, auth.sessionId, "upload", {
        ...(bundle.detectedIntent.status === "supported"
          ? { intentId: bundle.detectedIntent.intentId }
          : { fallbackReason: bundle.detectedIntent.reasonCode }),
        latencyMs: Date.now() - startedAt,
      });
      return AudioTranscriptionResponseSchema.parse({
        session: completeSession(session, "complete"),
        segments,
        stableUtterances: [bundle.utterance],
        detectedIntents: [bundle.detectedIntent],
        ...(bundle.detectedIntent.status === "unsupported"
          ? { fallbackReason: bundle.detectedIntent.reasonCode }
          : {}),
      });
    } catch (error) {
      const reasonCode: UnsupportedReasonCode =
        error instanceof TranscriptionFallbackError ? error.reasonCode : "model_unavailable";
      await recordTranscriptionTerminal(dependencies, auth.siteId, auth.sessionId, "upload", {
        fallbackReason: reasonCode,
        latencyMs: Date.now() - startedAt,
      });
      return AudioTranscriptionResponseSchema.parse({
        session: completeSession(session, "complete"),
        segments,
        stableUtterances: [],
        detectedIntents: [],
        fallbackReason: reasonCode,
      });
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/utterances/:id/decision",
    { preHandler: requireSite },
    async (request, reply) => {
      const auth = request.authSession;
      if (!auth) return reply.code(401).send({ error: "authentication_required" });
      const parsed = DecisionRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_decision" });
      const decisionStartedAt = Date.now();
      const pending = await pendingDecisions.consume(
        request.params.id,
        auth.sessionId,
        parsed.data.decision,
        parsed.data.detectedIntentId,
      );
      if (!pending) return reply.code(404).send({ error: "utterance_not_found_or_already_decided" });
      await events.record({
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        siteId: auth.siteId,
        sessionId: auth.sessionId,
        type: "staff_decision",
        staffDecision: parsed.data.decision,
        ...(pending.intentId ? { intentId: pending.intentId } : {}),
      });

      if (parsed.data.decision === "fallback" || pending.detectedIntent.status !== "supported") {
        const reasonCode: UnsupportedReasonCode =
          parsed.data.decision === "fallback"
            ? "staff_selected_fallback"
            : normalizePendingReason(pending.reasonCode);
        await recordFallback(events, auth.siteId, auth.sessionId, reasonCode, pending.intentId);
        return DecisionResponseSchema.parse({
          status: "captions_only",
          utteranceId: pending.utteranceId,
          reasonCode,
        });
      }

      const asset = catalog.assetForIntent(pending.detectedIntent.intentId);
      if (!asset) {
        await recordFallback(events, auth.siteId, auth.sessionId, "asset_unavailable", pending.intentId);
        return DecisionResponseSchema.parse({
          status: "captions_only",
          utteranceId: pending.utteranceId,
          reasonCode: "asset_unavailable",
        });
      }
      const revocationRegistry = await revocations.current();
      if (
        isAssetRevoked(revocationRegistry, {
          assetId: asset.id,
          assetSha256: asset.sha256,
          catalogVersion: catalog.current().catalogVersion,
        })
      ) {
        await recordFallback(events, auth.siteId, auth.sessionId, "asset_withdrawn", pending.intentId);
        return DecisionResponseSchema.parse({
          status: "captions_only",
          utteranceId: pending.utteranceId,
          reasonCode: "asset_withdrawn",
        });
      }
      try {
        const createdAt = new Date().toISOString();
        const signPlan = createSignPlan({
          id: randomUUID(),
          createdAt,
          utterance: pending.utterance,
          detectedIntent: pending.detectedIntent,
          catalog: catalog.current(),
          revocations: revocationRegistry,
        });
        const signed = await assetSigner.sign(asset);
        const renderSegment = createRenderSegment({
          id: randomUUID(),
          signPlan,
          catalog: catalog.current(),
          caption: signPlan.caption,
          videoUrl: signed.url,
          urlExpiresAt: signed.expiresAt,
          playbackRate: 1,
          revocations: revocationRegistry,
        });
        await playbackGrants.put({
          utteranceId: pending.utteranceId,
          assetId: asset.id,
          sessionId: auth.sessionId,
          expiresAt: signed.expiresAt,
        });
        await events.record({
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          siteId: auth.siteId,
          sessionId: auth.sessionId,
          type: "asset_url_issued",
          intentId: pending.detectedIntent.intentId,
          assetId: asset.id,
          catalogVersion: catalog.current().catalogVersion,
          latencyKind: "warm_playback_after_confirmation",
          latencyMs: Date.now() - decisionStartedAt,
        });
        return DecisionResponseSchema.parse({ status: "ready", signPlan, renderSegment });
      } catch (error) {
        const reasonCode: UnsupportedReasonCode =
          error instanceof AssetUnavailableError && /hash/i.test(error.message)
            ? "asset_hash_mismatch"
            : "asset_unavailable";
        request.log.warn({ assetId: asset.id }, "asset playback preparation failed");
        await recordFallback(events, auth.siteId, auth.sessionId, reasonCode, pending.intentId);
        return DecisionResponseSchema.parse({
          status: "captions_only",
          utteranceId: pending.utteranceId,
          reasonCode,
        });
      }
    },
  );

  app.post("/api/playback-events", { preHandler: requireSite }, async (request, reply) => {
    const auth = request.authSession;
    if (!auth) return reply.code(401).send({ error: "authentication_required" });
    const parsed = PlaybackEventSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_playback_event" });
    const accepted = await playbackGrants.record(
      parsed.data.utteranceId,
      parsed.data.assetId,
      auth.sessionId,
      parsed.data.result,
    );
    if (!accepted) return reply.code(409).send({ error: "playback_event_not_authorized" });
    await events.record({
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      siteId: auth.siteId,
      sessionId: auth.sessionId,
      type: "playback_event",
      assetId: parsed.data.assetId,
      playbackResult: parsed.data.result,
    });
    return reply.code(202).send({ accepted: true });
  });

  app.post("/api/feedback", { preHandler: requireSite }, async (request, reply) => {
    const auth = request.authSession;
    if (!auth) return reply.code(401).send({ error: "authentication_required" });
    const parsed = FeedbackRequestSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.sessionId !== auth.sessionId) {
      return reply.code(400).send({ error: "invalid_feedback" });
    }
    const feedbackId = randomUUID();
    await events.record({
      eventId: feedbackId,
      occurredAt: new Date().toISOString(),
      siteId: auth.siteId,
      sessionId: auth.sessionId,
      type: "feedback_received",
      ...(parsed.data.assetId ? { assetId: parsed.data.assetId } : {}),
      feedbackCategory: parsed.data.issueCategory,
      feedbackSeverity: parsed.data.severity,
    });
    return FeedbackResponseSchema.parse({ accepted: true, feedbackId });
  });

  app.get("/api/admin/metrics", { preHandler: requireAdmin }, async (request) => {
    const daysRaw = (request.query as { days?: string }).days;
    const days = Math.max(1, Math.min(config.eventRetentionDays, Number(daysRaw) || 7));
    const from = new Date(Date.now() - days * 86_400_000);
    const to = new Date();
    const metrics = await events.metrics(from, to);
    return AdminMetricsResponseSchema.parse({
      window: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        sessions: metrics.totals.sessions,
        liveSessions: metrics.totals.liveSessions,
        uploadSessions: metrics.totals.uploadSessions,
        supportedCandidates: metrics.totals.supportedCandidates,
        fallbacks: metrics.totals.fallbacks,
        staffRejections: metrics.totals.staffRejections,
        playbackFailures: metrics.totals.playbackFailures,
        agentRuns: metrics.totals.operationsReports,
      },
      latencyP95Ms: {
        firstProvisionalCaption: metrics.latencyP95Ms.firstProvisionalCaption,
        finalAfterRelease: metrics.latencyP95Ms.finalAfterRelease,
        finalToIntentCandidate: metrics.latencyP95Ms.finalToIntentCandidate,
        warmPlaybackAfterConfirmation: metrics.latencyP95Ms.warmPlaybackAfterConfirmation,
      },
      fallbackReasons: Object.fromEntries(
        UNSUPPORTED_REASON_CODES.map((reason) => [reason, metrics.fallbackReasons[reason] ?? 0]),
      ),
      generatedAt: new Date().toISOString(),
    });
  });

  app.post("/api/internal/operations/daily", async (request, reply) => {
    if (!(await authenticateInternalRequest(request, config))) {
      return reply.code(401).send({ error: "internal_authentication_required" });
    }
    const metrics = await events.metrics(new Date(Date.now() - 86_400_000));
    try {
      const report = await dependencies.classifier.createOperationsReport(metrics);
      if (report.execution !== "gemini") {
        return reply.code(503).send({ error: "operations_agent_unavailable" });
      }
      await events.saveOperationsReport(report, config.pilotSiteId);
      return { accepted: true, report };
    } catch {
      request.log.warn("operations agent failed");
      return reply.code(503).send({ error: "operations_agent_unavailable" });
    }
  });
}

function normalizeMimeType(value: string): "audio/wav" | "audio/mpeg" | "audio/webm" | null {
  if (value === "audio/wav" || value === "audio/x-wav") return "audio/wav";
  if (value === "audio/mpeg" || value === "audio/mp3") return "audio/mpeg";
  if (value === "audio/webm") return "audio/webm";
  return null;
}

function completeSession(session: AudioSession, lifecycle: "complete" | "failed"): AudioSession {
  return { ...session, lifecycle, endedAt: new Date().toISOString() };
}

function normalizePendingReason(reason: string): UnsupportedReasonCode {
  return reason === "matched_supported_intent" ? "unknown_intent" : (reason as UnsupportedReasonCode);
}

async function recordFallback(
  events: AppDependencies["events"],
  siteId: string,
  sessionId: string,
  reasonCode: UnsupportedReasonCode,
  intentId?: ReceptionIntentId,
): Promise<void> {
  await events.record({
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    siteId,
    sessionId,
    type: "fallback",
    fallbackReason: reasonCode,
    ...(intentId ? { intentId } : {}),
  });
}

async function recordTranscriptionTerminal(
  dependencies: AppDependencies,
  siteId: string,
  sessionId: string,
  flow: "live" | "upload",
  outcome: {
    fallbackReason?: UnsupportedReasonCode;
    intentId?: ReceptionIntentId;
    latencyMs?: number;
  },
): Promise<void> {
  await dependencies.events.record({
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    siteId,
    sessionId,
    type: "transcription_completed",
    flow,
    speechProvider: dependencies.transcription.speech.providerName,
    speechModel: dependencies.transcription.speech.model,
    ...(outcome.fallbackReason ? { fallbackReason: outcome.fallbackReason } : {}),
    ...(outcome.intentId ? { intentId: outcome.intentId } : {}),
    ...(outcome.latencyMs != null ? { latencyMs: outcome.latencyMs } : {}),
  });
}
