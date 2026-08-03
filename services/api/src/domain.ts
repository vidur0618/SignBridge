import type {
  DetectedIntent,
  ExperienceMode,
  ReceptionIntentId,
  StableUtterance,
  UnsupportedReasonCode,
} from "@signbridge/contracts";

export type SessionRole = "site" | "admin";

export interface AuthSession {
  sessionId: string;
  siteId: string;
  role: SessionRole;
  consentVersion: string;
  issuedAt: string;
  expiresAt: string;
}

export interface SpeechSegment {
  id: string;
  text: string;
  isFinal: boolean;
  startedAtMs: number;
  endedAtMs: number;
  provider: "google-cloud-speech" | "local-demo";
  model: string;
  confidence?: number;
  stability?: number;
}

export interface ClassificationResult {
  state: "supported" | "unsupported";
  intentId?: ReceptionIntentId;
  reasonCode: "matched_supported_intent" | UnsupportedReasonCode;
  model: string | null;
  invocationId: string | null;
  requiresHumanConfirmation: true;
}

export interface PendingDecision {
  utteranceId: string;
  sessionId: string;
  siteId: string;
  intentId?: ReceptionIntentId;
  state: "supported" | "unsupported";
  reasonCode: "matched_supported_intent" | UnsupportedReasonCode;
  detectedIntent: DetectedIntent;
  utterance: StableUtterance;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  decision?: "play" | "fallback";
}

export interface UsageEvent {
  eventId: string;
  occurredAt: string;
  siteId: string;
  sessionId: string;
  type:
    | "session_started"
    | "transcription_completed"
    | "intent_detected"
    | "staff_decision"
    | "asset_url_issued"
    | "fallback"
    | "feedback_received"
    | "playback_event"
    | "avatar_authorized"
    | "avatar_execution"
    | "latency_sample"
    | "operations_report";
  flow?: "live" | "upload" | "typed" | "manual";
  outputLane?: ExperienceMode;
  speechProvider?: string;
  speechModel?: string;
  classifierProvider?: "gemini" | "local-demo";
  classifierModel?: string;
  classifierInvocationId?: string;
  intentId?: ReceptionIntentId;
  assetId?: string;
  catalogVersion?: string;
  fallbackReason?: string;
  staffDecision?: "play" | "fallback";
  latencyMs?: number;
  playbackResult?: "started" | "completed" | "failed";
  latencyKind?:
    | "first_provisional_caption"
    | "final_after_release"
    | "final_to_intent_candidate"
    | "warm_playback_after_confirmation";
  feedbackCategory?: string;
  feedbackSeverity?: string;
  consentVersion?: string;
  avatarProvider?: "handtalk";
  avatarName?: "HUGO" | "MAYA";
  avatarAuthorizationId?: string;
  avatarResult?: "started" | "completed" | "failed";
  avatarLatencyMs?: number;
  reportId?: string;
}

export interface AggregateMetrics {
  windowStartedAt: string;
  windowEndedAt: string;
  totals: {
    sessions: number;
    liveSessions: number;
    uploadSessions: number;
    transcriptions: number;
    supportedCandidates: number;
    fallbacks: number;
    staffRejections: number;
    assetUrlsIssued: number;
    playbackFailures: number;
    feedback: number;
    operationsReports: number;
  };
  fallbackReasons: Record<string, number>;
  intentCounts: Partial<Record<ReceptionIntentId, number>>;
  latencyP95Ms: {
    firstProvisionalCaption: number | null;
    finalAfterRelease: number | null;
    finalToIntentCandidate: number | null;
    warmPlaybackAfterConfirmation: number | null;
  };
}

export interface PlaybackGrant {
  utteranceId: string;
  assetId: string;
  sessionId: string;
  expiresAt: string;
  terminalResult?: "completed" | "failed";
}

export interface OperationsReport {
  reportId: string;
  generatedAt: string;
  model: string | null;
  invocationId: string | null;
  execution: "gemini" | "local-demo" | "unavailable";
  summary: string;
  priorities: readonly string[];
  recommendedFollowUps: readonly string[];
}

declare module "fastify" {
  interface FastifyRequest {
    authSession?: AuthSession;
  }
}
