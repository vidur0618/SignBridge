import { randomUUID } from "node:crypto";
import {
  AudioSessionSchema,
  DetectedIntentSchema,
  TranscriptSegmentSchema,
  createStableUtterance,
  runSafetyGate,
  type AudioSession,
  type DetectedIntent,
  type StableUtterance,
  type TranscriptSegment,
  type UnsupportedReasonCode,
} from "@signbridge/contracts";
import { z } from "zod";
import type { AuthSession, ClassificationResult, PendingDecision, SpeechSegment } from "./domain.js";
import type { IntentClassifier } from "./adapters/classifier.js";
import type { SpeechProvider } from "./adapters/speech.js";
import type { EventRepository, PendingDecisionRepository } from "./repositories.js";

export interface ClassificationBundle {
  utterance: StableUtterance;
  detectedIntent: DetectedIntent;
}

export class TranscriptionFallbackError extends Error {
  readonly reasonCode: UnsupportedReasonCode;

  constructor(reasonCode: UnsupportedReasonCode) {
    super(`Transcription must use captions-only fallback: ${reasonCode}`);
    this.name = "TranscriptionFallbackError";
    this.reasonCode = reasonCode;
  }
}

export class TranscriptionService {
  readonly #speech: SpeechProvider;
  readonly #classifier: IntentClassifier;
  readonly #pending: PendingDecisionRepository;
  readonly #events: EventRepository;

  constructor(
    speech: SpeechProvider,
    classifier: IntentClassifier,
    pending: PendingDecisionRepository,
    events: EventRepository,
  ) {
    this.#speech = speech;
    this.#classifier = classifier;
    this.#pending = pending;
    this.#events = events;
  }

  get speech(): SpeechProvider {
    return this.#speech;
  }

  createAudioSession(
    auth: AuthSession,
    mode: "live" | "upload",
    lifecycle: AudioSession["lifecycle"],
    encoding: "LINEAR16" | "WAV" | "MP3" | "WEBM_OPUS",
    now = new Date(),
  ): AudioSession {
    return AudioSessionSchema.parse({
      id: randomUUID(),
      siteId: auth.siteId,
      mode,
      locale: "en-US",
      consentVersion: auth.consentVersion,
      audio: {
        encoding,
        sampleRateHertz: mode === "live" ? 16_000 : 16_000,
        channelCount: 1,
      },
      lifecycle,
      retention: "none",
      createdAt: now.toISOString(),
    });
  }

  toTranscriptSegment(
    sessionId: string,
    sequence: number,
    segment: SpeechSegment,
    receivedAt = new Date(),
  ): TranscriptSegment {
    const startMs = Math.max(0, Math.round(segment.startedAtMs));
    const endMs = Math.max(startMs + 1, Math.round(segment.endedAtMs));
    return TranscriptSegmentSchema.parse({
      id: segment.id,
      sessionId,
      sequence,
      state: segment.isFinal ? "final" : "partial",
      text: segment.text,
      startMs,
      endMs,
      ...(segment.stability != null ? { stability: segment.stability } : {}),
      ...(segment.confidence != null ? { confidence: segment.confidence } : {}),
      provider: "google-cloud-speech-v2",
      model: segment.model,
      receivedAt: receivedAt.toISOString(),
    });
  }

  stabilizeFinalSegments(
    session: AudioSession,
    segments: readonly TranscriptSegment[],
  ): StableUtterance {
    const preflightText = [...segments]
      .sort((left, right) => left.sequence - right.sequence)
      .map((segment) => segment.text)
      .join(" ")
      .trim();
    if (preflightText.length > 2_000) {
      throw new TranscriptionFallbackError("transcript_too_long");
    }
    return createStableUtterance({
      id: randomUUID(),
      sessionId: session.id,
      segments,
      finalizedAt: new Date().toISOString(),
    });
  }

  async classifyFinalSegments(
    auth: AuthSession,
    session: AudioSession,
    segments: readonly TranscriptSegment[],
    flow: "live" | "upload",
  ): Promise<ClassificationBundle> {
    const detectionStartedAt = Date.now();
    const utterance = this.stabilizeFinalSegments(session, segments);
    const preflight = runSafetyGate({
      text: utterance.transcript,
      locale: "en-US",
      isFinal: segments.every((segment) => segment.state === "final"),
    });
    if (!preflight.allowed && preflight.reasonCode === "transcript_too_long") {
      throw new TranscriptionFallbackError("transcript_too_long");
    }
    const detectedIntent = await this.#detect(utterance);
    if (detectedIntent.status === "supported") {
      const pending: PendingDecision = {
        utteranceId: utterance.id,
        sessionId: auth.sessionId,
        siteId: auth.siteId,
        state: detectedIntent.status,
        intentId: detectedIntent.intentId,
        reasonCode: detectedIntent.reasonCode,
        detectedIntent,
        utterance,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      };
      await this.#pending.put(pending);
    }

    await this.#events.record({
      eventId: randomUUID(),
      occurredAt: detectedIntent.classifiedAt,
      siteId: auth.siteId,
      sessionId: auth.sessionId,
      type: "intent_detected",
      flow,
      speechProvider: this.#speech.providerName,
      speechModel: this.#speech.model,
      ...(detectedIntent.status === "supported" ? { intentId: detectedIntent.intentId } : {}),
      ...(detectedIntent.status === "unsupported"
        ? { fallbackReason: detectedIntent.reasonCode }
        : {}),
      ...(detectedIntent.execution.route === "gemini"
        ? {
            classifierProvider: "gemini" as const,
            classifierModel: detectedIntent.execution.model as string,
            classifierInvocationId: detectedIntent.execution.invocationId as string,
          }
        : {}),
      latencyKind: "final_to_intent_candidate",
      latencyMs: Date.now() - detectionStartedAt,
    });
    return { utterance, detectedIntent };
  }

  async #detect(utterance: StableUtterance): Promise<DetectedIntent> {
    const safety = runSafetyGate({
      text: utterance.transcript,
      locale: "en-US",
      isFinal: utterance.isFinal,
    });
    let classification: ClassificationResult;
    let executionRoute: "gemini" | "deterministic" | "not_invoked";
    if (!safety.allowed) {
      classification = {
        state: "unsupported",
        reasonCode: safety.reasonCode,
        model: null,
        invocationId: null,
        requiresHumanConfirmation: true,
      };
      executionRoute = "deterministic";
    } else {
      try {
        classification = await this.#classifier.classify(safety.normalizedText);
        executionRoute =
          classification.model && classification.invocationId ? "gemini" : "not_invoked";
        if (
          classification.state === "supported" &&
          (!classification.intentId || executionRoute !== "gemini")
        ) {
          classification = unsupported("model_schema_invalid");
          executionRoute = "not_invoked";
        }
      } catch (error) {
        const reasonCode: UnsupportedReasonCode = isTimeout(error)
          ? "model_timeout"
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? "model_schema_invalid"
            : "model_unavailable";
        classification = unsupported(reasonCode);
        executionRoute = "not_invoked";
      }
    }

    const base = {
      id: randomUUID(),
      utteranceId: utterance.id,
      execution: {
        route: executionRoute,
        model: executionRoute === "gemini" ? classification.model : null,
        invocationId: executionRoute === "gemini" ? classification.invocationId : null,
      },
      requiresHumanConfirmation: true,
      classifiedAt: new Date().toISOString(),
    } as const;
    const detected =
      classification.state === "supported" && classification.intentId
        ? {
            ...base,
            status: "supported" as const,
            intentId: classification.intentId,
            reasonCode: "matched_supported_intent" as const,
          }
        : {
            ...base,
            status: "unsupported" as const,
            intentId: null,
            reasonCode: normalizeUnsupportedReason(classification.reasonCode),
          };
    const parsed = DetectedIntentSchema.parse(detected);
    return parsed;
  }
}

function unsupported(reasonCode: UnsupportedReasonCode): ClassificationResult {
  return {
    state: "unsupported",
    reasonCode,
    model: null,
    invocationId: null,
    requiresHumanConfirmation: true,
  };
}

function normalizeUnsupportedReason(
  reasonCode: ClassificationResult["reasonCode"],
): UnsupportedReasonCode {
  return reasonCode === "matched_supported_intent" ? "unknown_intent" : reasonCode;
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError" || /timeout/i.test(error.message))
  );
}
