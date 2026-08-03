import {
  AccessCodeExchangeResponseSchema,
  AdminMetricsResponseSchema,
  AvatarAuthorizationResponseSchema,
  AvatarExecutionEventResponseSchema,
  AvatarRuntimeConfigResponseSchema,
  AudioTranscriptionResponseSchema,
  CatalogPublicResponseSchema,
  DecisionResponseSchema,
  FeedbackResponseSchema,
  type AccessCodeExchangeRequest,
  type AvatarAuthorizationResponse,
  type AvatarExecutionEventRequest,
  type AvatarMessageSource,
  type DecisionRequest,
  type FeedbackRequest,
  type ExperienceMode,
} from "@signbridge/contracts";
import type {
  AvatarRuntimeConfig,
  DashboardMetrics,
  IntentCandidate,
  IntentId,
  LiveCaptionEvent,
  PlaybackAsset,
  PublicCatalog,
} from "./models.js";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const CURRENT_CONSENT_VERSION = "v2026-08-02-avatar";

export interface SessionInfo {
  sessionId: string;
  siteId: string;
  expiresAt: string;
  consentVersion: typeof CURRENT_CONSENT_VERSION;
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const record = asRecord(payload);
    const code = stringValue(record?.code ?? record?.error ?? record?.fallbackReason);
    throw new ApiError(
      stringValue(record?.message) ?? publicErrorMessage(code),
      response.status,
      code,
    );
  }
  return payload;
}

function publicErrorMessage(code: string | undefined): string {
  if (code === "audio_too_long") return "Choose a recording that is 60 seconds or shorter.";
  if (code === "invalid_audio") return "The audio could not be verified or transcribed. Try another file or use typing.";
  if (code === "unsupported_audio_type") return "Choose a WAV, MP3, or WebM audio file.";
  if (code === "audio_too_large") return "Choose an audio file smaller than 10 MB.";
  if (code === "rate_limited") return "This pilot is busy. Wait briefly or use typing.";
  return "The request could not be completed. Use captions or typing to continue.";
}

export async function exchangeSession(accessCode: string): Promise<SessionInfo> {
  const body: AccessCodeExchangeRequest = {
    accessCode,
    consentVersion: CURRENT_CONSENT_VERSION,
  };
  const payload = parseContract(AccessCodeExchangeResponseSchema.safeParse(await requestJson("/api/session/exchange", {
    method: "POST",
    body: JSON.stringify(body),
  })), "session exchange");
  return {
    sessionId: payload.sessionId,
    siteId: payload.siteId,
    expiresAt: payload.expiresAt,
    consentVersion: CURRENT_CONSENT_VERSION,
  };
}

export async function endSession(): Promise<void> {
  await requestJson("/api/session", { method: "DELETE" });
}

export async function loadCatalog(): Promise<PublicCatalog> {
  const payload = parseContract(CatalogPublicResponseSchema.safeParse(await requestJson("/api/catalog")), "public catalog");
  const intents = payload.intents.map((row) => {
    const id = row.id;
    return {
      id,
      title: id.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      description: row.publicDescription,
      caption: row.publicDescription,
      available: row.available,
    };
  });
  return {
    version: payload.catalogVersion,
    language: "ase-US",
    intents,
  };
}

export async function loadAvatarConfig(): Promise<AvatarRuntimeConfig> {
  return parseContract(
    AvatarRuntimeConfigResponseSchema.safeParse(await requestJson("/api/avatar/config")),
    "avatar runtime configuration",
  );
}

export async function authorizeAvatar(
  text: string,
  source: AvatarMessageSource,
): Promise<AvatarAuthorizationResponse> {
  return parseContract(
    AvatarAuthorizationResponseSchema.safeParse(await requestJson("/api/avatar/authorize", {
      method: "POST",
      body: JSON.stringify({
        text,
        locale: "en-US",
        source,
        staffConfirmed: true,
      }),
    })),
    "avatar authorization",
  );
}

export async function reportAvatarExecution(input: AvatarExecutionEventRequest): Promise<void> {
  parseContract(
    AvatarExecutionEventResponseSchema.safeParse(await requestJson("/api/avatar/events", {
      method: "POST",
      body: JSON.stringify(input),
    })),
    "avatar execution event",
  );
}

export interface TranscriptionResult {
  transcript: string;
  candidate?: IntentCandidate;
}

export async function transcribeAudio(
  file: File,
  outputLane: ExperienceMode,
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("audio", file, file.name);
  const payload = parseContract(AudioTranscriptionResponseSchema.safeParse(await requestJson(
    `/api/audio/transcribe?outputLane=${encodeURIComponent(outputLane)}`,
    { method: "POST", body: form },
  )), "audio transcription");
  if (payload.outputLane !== outputLane) {
    throw new ApiError("The server returned an audio response for another output lane.", 502, "invalid_contract");
  }
  return normalizeTranscriptionResult(payload);
}

export async function submitDecision(
  utteranceId: string,
  detectedIntentId: string,
  decision: "play" | "fallback",
): Promise<PlaybackAsset | null> {
  const body: DecisionRequest = { decision, detectedIntentId };
  const response = parseContract(DecisionResponseSchema.safeParse(await requestJson(`/api/utterances/${encodeURIComponent(utteranceId)}/decision`, {
    method: "POST",
    body: JSON.stringify(body),
  })), "staff decision");
  if (decision === "fallback") return null;
  const payload = asRecord(response);
  const render = asRecord(payload?.renderSegment ?? payload?.render ?? payload);
  const signPlan = asRecord(payload?.signPlan);
  const url = stringValue(render?.videoUrl ?? render?.url ?? render?.signedUrl);
  const intentId = stringValue(signPlan?.intentId ?? render?.intentId);
  const reviewerReference = stringValue(asRecord(signPlan?.approvalProvenance)?.reviewerRef);
  if (!url || !isIntentId(intentId)) throw new ApiError("The approved signing video is unavailable.", 502, "asset_unavailable");
  return {
    utteranceId: stringValue(render?.utteranceId ?? signPlan?.utteranceId) ?? utteranceId,
    url,
    expiresAt: stringValue(render?.urlExpiresAt ?? render?.expiresAt) ?? new Date(Date.now() + 5 * 60_000).toISOString(),
    caption: stringValue(render?.caption ?? signPlan?.caption) ?? "",
    intentId,
    catalogVersion: stringValue(signPlan?.catalogVersion) ?? "unknown",
    assetId: stringValue(render?.assetId ?? signPlan?.assetId) ?? "unknown",
    ...(reviewerReference ? { reviewerReference } : {}),
  };
}

export async function reportPlayback(input: {
  utteranceId: string;
  assetId: string;
  result: "started" | "completed" | "failed";
}): Promise<void> {
  await requestJson("/api/playback-events", { method: "POST", body: JSON.stringify(input) });
}

export async function sendFeedback(input: FeedbackRequest): Promise<void> {
  parseContract(FeedbackResponseSchema.safeParse(await requestJson("/api/feedback", { method: "POST", body: JSON.stringify(input) })), "feedback response");
}

export async function loadMetrics(): Promise<DashboardMetrics> {
  const validated = parseContract(AdminMetricsResponseSchema.safeParse(await requestJson("/api/admin/metrics")), "admin metrics");
  const payload = asRecord(validated);
  const summary = asRecord(payload?.totals ?? payload?.summary ?? payload);
  const latency = asRecord(payload?.latencyP95Ms);
  const reasonRecord = asRecord(payload?.fallbackReasons);
  const sessions = numberValue(summary?.sessions);
  const supported = numberValue(summary?.supportedCandidates);
  const fallbacks = numberValue(summary?.fallbacks);
  const rejections = numberValue(summary?.staffRejections);
  const playbackFailures = numberValue(summary?.playbackFailures);
  const approved = Math.max(0, supported - rejections);
  const windowRecord = asRecord(payload?.window);
  return {
    windowLabel: stringValue(windowRecord?.from) && stringValue(windowRecord?.to)
      ? `${new Date(stringValue(windowRecord?.from) ?? "").toLocaleDateString()}–${new Date(stringValue(windowRecord?.to) ?? "").toLocaleDateString()}`
      : "Current reporting window",
    sessions,
    supportedCandidates: supported,
    fallbackRate: sessions > 0 ? fallbacks / sessions : 0,
    staffAcceptanceRate: supported > 0 ? approved / supported : 0,
    playbackSuccessRate: approved > 0 ? Math.max(0, approved - playbackFailures) / approved : 0,
    p95FinalTranscriptMs: nullableNumber(latency?.finalAfterRelease ?? summary?.p95FinalTranscriptMs),
    p95IntentMs: nullableNumber(latency?.finalToIntentCandidate ?? summary?.p95IntentMs),
    fallbackReasons: reasonRecord ? Object.entries(reasonRecord).map(([reason, count]) => ({ reason, count: numberValue(count) })) : [],
    agentRuns: [],
    agentRunCount: numberValue(summary?.agentRuns),
  };
}

function normalizeTranscriptionResult(payload: Record<string, unknown> | null): TranscriptionResult {
  const segments = Array.isArray(payload?.segments) ? payload.segments : [];
  const stableUtterances = Array.isArray(payload?.stableUtterances) ? payload.stableUtterances : [];
  const detectedIntents = Array.isArray(payload?.detectedIntents) ? payload.detectedIntents : [];
  const utterance = asRecord(payload?.utterance ?? payload?.stableUtterance ?? stableUtterances.at(-1));
  const fallbackReason = stringValue(payload?.fallbackReason);
  const detected = asRecord(
    payload?.detectedIntent
      ?? payload?.intent
      ?? payload?.candidate
      ?? detectedIntents.at(-1)
      ?? (fallbackReason ? { status: "unsupported", reasonCode: fallbackReason } : null),
  );
  const finalizedTranscript = segments
    .map((segment) => stringValue(asRecord(segment)?.text))
    .filter((text): text is string => Boolean(text))
    .join(" ")
    .trim();
  const transcript = stringValue(utterance?.transcript ?? utterance?.text ?? payload?.transcript)
    ?? finalizedTranscript;
  const utteranceId = stringValue(utterance?.id ?? detected?.utteranceId ?? payload?.utteranceId) ?? crypto.randomUUID();
  return {
    transcript,
    ...(detected ? { candidate: normalizeCandidate(detected, utteranceId, transcript) } : {}),
  };
}

export function normalizeLiveEvent(payload: unknown): LiveCaptionEvent | null {
  const event = asRecord(payload);
  const rawType = stringValue(event?.type);
  if (!rawType) return null;
  const typeMap: Record<string, LiveCaptionEvent["type"]> = {
    partial: "partial",
    transcript_partial: "partial",
    "transcript.partial": "partial",
    final: "final",
    transcript_final: "final",
    "transcript.final": "final",
    candidate: "candidate",
    intent_candidate: "candidate",
    "intent.candidate": "candidate",
    speech_end: "speech_end",
    speech_end_timeout: "speech_end",
    fallback: "fallback",
    error: "error",
    ready: "ready",
    session_ready: "ready",
    "session.ready": "ready",
  };
  const type = typeMap[rawType];
  if (!type) return null;
  const transcript = asRecord(event?.segment ?? event?.utterance);
  const text = stringValue(event?.text ?? transcript?.text ?? transcript?.transcript);
  const utteranceRecord = asRecord(event?.utterance);
  const utteranceId = stringValue(event?.utteranceId ?? utteranceRecord?.id ?? transcript?.id);
  const candidateRecord = asRecord(event?.candidate ?? event?.detectedIntent);
  const message = stringValue(event?.message);
  const code = stringValue(event?.reasonCode ?? event?.code);
  return {
    type,
    ...(text ? { text } : {}),
    ...(utteranceId ? { utteranceId } : {}),
    ...(candidateRecord ? { candidate: normalizeCandidate(candidateRecord, utteranceId ?? crypto.randomUUID(), text ?? "") } : {}),
    ...(message ? { message } : {}),
    ...(code ? { code } : {}),
  };
}

function normalizeCandidate(
  input: Record<string, unknown> | null,
  utteranceId: string,
  transcript: string,
): IntentCandidate {
  const supported = input?.status === "supported" || input?.supported === true;
  const maybeIntentId = stringValue(input?.intentId);
  const intentId = isIntentId(maybeIntentId) ? maybeIntentId : undefined;
  const title = stringValue(input?.title);
  const description = stringValue(input?.description);
  const model = stringValue(asRecord(input?.execution)?.model ?? input?.model);
  const invocationId = stringValue(asRecord(input?.execution)?.invocationId ?? input?.invocationId);
  return {
    detectedIntentId: stringValue(input?.id) ?? crypto.randomUUID(),
    utteranceId,
    transcript,
    supported: supported && Boolean(intentId),
    ...(intentId ? { intentId } : {}),
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    reasonCode: stringValue(input?.reasonCode) ?? (supported ? "supported" : "unsupported"),
    ...(model ? { model } : {}),
    ...(invocationId ? { invocationId } : {}),
    requiresHumanConfirmation: true,
  };
}

export function webSocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isIntentId(value: string | undefined): value is IntentId {
  return value === "greeting"
    || value === "offer_help"
    || value === "request_name_and_host"
    || value === "notify_host"
    || value === "ask_wait"
    || value === "explain_short_delay"
    || value === "follow_staff"
    || value === "offer_directions"
    || value === "repeat_communication"
    || value === "offer_alternatives";
}

function parseContract<T>(result: { success: true; data: T } | { success: false }, label: string): T {
  if (!result.success) throw new ApiError(`The server returned an invalid ${label} response.`, 502, "invalid_contract");
  return result.data;
}
