import type { ReceptionIntentId } from "@signbridge/contracts";

export const INTENT_IDS = [
  "greeting",
  "offer_help",
  "request_name_and_host",
  "notify_host",
  "ask_wait",
  "explain_short_delay",
  "follow_staff",
  "offer_directions",
  "repeat_communication",
  "offer_alternatives",
] as const satisfies readonly ReceptionIntentId[];

export type IntentId = ReceptionIntentId;
export type ExperienceMode = "asl_captions" | "captions_only";
export type InputMethod = "speak" | "upload" | "type" | "phrases";
export type RuntimeMode = "live" | "demo";

export interface CatalogIntent {
  id: IntentId;
  title: string;
  description: string;
  caption: string;
  available: boolean;
}

export interface PublicCatalog {
  version: string;
  language: "ase-US";
  intents: CatalogIntent[];
}

export interface IntentCandidate {
  detectedIntentId: string;
  utteranceId: string;
  transcript: string;
  supported: boolean;
  intentId?: IntentId;
  title?: string;
  description?: string;
  reasonCode: string;
  model?: string;
  invocationId?: string;
  requiresHumanConfirmation: true;
}

export interface PlaybackAsset {
  utteranceId: string;
  url: string;
  expiresAt: string;
  caption: string;
  intentId: IntentId;
  catalogVersion: string;
  assetId: string;
  reviewerReference?: string;
}

export interface DashboardMetrics {
  windowLabel: string;
  sessions: number;
  supportedCandidates: number;
  fallbackRate: number;
  staffAcceptanceRate: number;
  playbackSuccessRate: number;
  p95FinalTranscriptMs: number | null;
  p95IntentMs: number | null;
  fallbackReasons: Array<{ reason: string; count: number }>;
  agentRuns: Array<{ startedAt: string; status: string; model?: string }>;
  agentRunCount: number;
}

export interface LiveCaptionEvent {
  type: "partial" | "final" | "candidate" | "speech_end" | "fallback" | "error" | "ready";
  text?: string;
  utteranceId?: string;
  candidate?: IntentCandidate;
  message?: string;
  code?: string;
}
