import { z } from "zod";

import {
  HttpsUrlSchema,
  IdentifierSchema,
  IsoTimestampSchema,
  LanguagePackSchema,
  LocaleSchema,
  SafeReferenceSchema,
  Sha256Schema,
  VersionSchema,
} from "./common.js";
import {
  ReceptionIntentIdSchema,
  UnsupportedReasonCodeSchema,
} from "./intents.js";

export const AudioModeSchema = z.enum(["live", "upload"]);
export type AudioMode = z.infer<typeof AudioModeSchema>;

/**
 * The operator-selected output lane. This is intentionally separate from the
 * audio input mode so choosing captions or the experimental avatar can never
 * be mistaken for consent to run reviewed-phrase intent classification.
 */
export const ExperienceModeSchema = z.enum([
  "captions_only",
  "asl_captions",
  "avatar_captions",
]);
export type ExperienceMode = z.infer<typeof ExperienceModeSchema>;

export const AudioConfigurationSchema = z
  .object({
    encoding: z.enum(["LINEAR16", "WAV", "MP3", "WEBM_OPUS"]),
    sampleRateHertz: z.number().int().min(8_000).max(48_000),
    channelCount: z.literal(1),
  })
  .strict();
export type AudioConfiguration = z.infer<typeof AudioConfigurationSchema>;

export const AudioSessionSchema = z
  .object({
    id: IdentifierSchema,
    siteId: IdentifierSchema,
    mode: AudioModeSchema,
    locale: LocaleSchema,
    consentVersion: VersionSchema,
    audio: AudioConfigurationSchema,
    lifecycle: z.enum(["initializing", "listening", "finalizing", "complete", "failed", "cancelled"]),
    retention: z.literal("none"),
    createdAt: IsoTimestampSchema,
    endedAt: IsoTimestampSchema.optional(),
  })
  .strict()
  .superRefine((session, context) => {
    if (session.mode === "live" && session.audio.encoding !== "LINEAR16") {
      context.addIssue({
        code: "custom",
        path: ["audio", "encoding"],
        message: "live audio must be 16 kHz mono LINEAR16 PCM",
      });
    }
    if (session.mode === "live" && session.audio.sampleRateHertz !== 16_000) {
      context.addIssue({
        code: "custom",
        path: ["audio", "sampleRateHertz"],
        message: "live audio must be 16 kHz mono LINEAR16 PCM",
      });
    }
  });
export type AudioSession = z.infer<typeof AudioSessionSchema>;

export const TranscriptSegmentSchema = z
  .object({
    id: IdentifierSchema,
    sessionId: IdentifierSchema,
    sequence: z.number().int().nonnegative(),
    state: z.enum(["partial", "final"]),
    text: z.string().trim().min(1).max(500),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    stability: z.number().min(0).max(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    provider: z.literal("google-cloud-speech-v2"),
    model: z.string().min(1).max(128),
    receivedAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((segment, context) => {
    if (segment.endMs <= segment.startMs) {
      context.addIssue({
        code: "custom",
        path: ["endMs"],
        message: "endMs must be greater than startMs",
      });
    }
  });
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const StableUtteranceSchema = z
  .object({
    id: IdentifierSchema,
    sessionId: IdentifierSchema,
    segmentIds: z.array(IdentifierSchema).min(1).max(100),
    transcript: z.string().trim().min(1).max(2_000),
    isFinal: z.literal(true),
    finalizationReason: z.enum(["asr_is_final", "typed_submission", "manual_phrase_selection"]),
    finalizedAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((utterance, context) => {
    if (new Set(utterance.segmentIds).size !== utterance.segmentIds.length) {
      context.addIssue({
        code: "custom",
        path: ["segmentIds"],
        message: "segmentIds must be unique",
      });
    }
  });
export type StableUtterance = z.infer<typeof StableUtteranceSchema>;

export const ModelExecutionSchema = z
  .object({
    route: z.enum(["gemini", "deterministic", "not_invoked"]),
    model: z.string().min(1).max(128).nullable(),
    invocationId: IdentifierSchema.nullable(),
  })
  .strict()
  .superRefine((execution, context) => {
    if (execution.route === "gemini" && (!execution.model || !execution.invocationId)) {
      context.addIssue({
        code: "custom",
        message: "Gemini execution requires the exact model and invocation ID",
      });
    }
    if (execution.route !== "gemini" && (execution.model !== null || execution.invocationId !== null)) {
      context.addIssue({
        code: "custom",
        message: "non-Gemini routes cannot claim a model execution",
      });
    }
  });
export type ModelExecution = z.infer<typeof ModelExecutionSchema>;

const DetectedSupportedIntentSchema = z
  .object({
    id: IdentifierSchema,
    utteranceId: IdentifierSchema,
    status: z.literal("supported"),
    intentId: ReceptionIntentIdSchema,
    reasonCode: z.literal("matched_supported_intent"),
    execution: ModelExecutionSchema,
    requiresHumanConfirmation: z.literal(true),
    classifiedAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.execution.route !== "gemini") {
      context.addIssue({
        code: "custom",
        path: ["execution", "route"],
        message: "supported intent candidates must record the Gemini execution",
      });
    }
  });

const DetectedUnsupportedIntentSchema = z
  .object({
    id: IdentifierSchema,
    utteranceId: IdentifierSchema,
    status: z.literal("unsupported"),
    intentId: z.null(),
    reasonCode: UnsupportedReasonCodeSchema,
    execution: ModelExecutionSchema,
    requiresHumanConfirmation: z.literal(true),
    classifiedAt: IsoTimestampSchema,
  })
  .strict();

export const DetectedIntentSchema = z.discriminatedUnion("status", [
  DetectedSupportedIntentSchema,
  DetectedUnsupportedIntentSchema,
]);
export type DetectedIntent = z.infer<typeof DetectedIntentSchema>;

export const ApprovalProvenanceSchema = z
  .object({
    reviewerRef: SafeReferenceSchema,
    reviewedSha256: Sha256Schema,
    rightsRef: SafeReferenceSchema,
    reviewedAt: IsoTimestampSchema,
  })
  .strict();
export type ApprovalProvenance = z.infer<typeof ApprovalProvenanceSchema>;

export const SignPlanSchema = z
  .object({
    id: IdentifierSchema,
    utteranceId: IdentifierSchema,
    intentId: ReceptionIntentIdSchema,
    assetId: IdentifierSchema,
    catalogVersion: VersionSchema,
    languagePack: LanguagePackSchema,
    caption: z.string().trim().min(1).max(500),
    approvalProvenance: ApprovalProvenanceSchema,
    fallbackRule: z.literal("captions_only"),
    wholeUtterance: z.literal(true),
    staffConfirmation: z.literal("required"),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type SignPlan = z.infer<typeof SignPlanSchema>;

export const RenderSegmentSchema = z
  .object({
    id: IdentifierSchema,
    signPlanId: IdentifierSchema,
    utteranceId: IdentifierSchema,
    assetId: IdentifierSchema,
    caption: z.string().trim().min(1).max(500),
    videoUrl: HttpsUrlSchema,
    urlExpiresAt: IsoTimestampSchema,
    playbackRate: z.union([z.literal(1), z.literal(0.75)]),
    playbackState: z.enum(["ready", "playing", "paused", "completed", "failed"]),
    objectFit: z.literal("contain"),
    mirrored: z.literal(false),
    captionsVisible: z.literal(true),
  })
  .strict();
export type RenderSegment = z.infer<typeof RenderSegmentSchema>;

export const FeedbackIssueCategorySchema = z.enum([
  "meaning_accuracy",
  "wrong_context",
  "facial_grammar",
  "presentation_crop",
  "presentation_mirror",
  "playback_failure",
  "caption_issue",
]);
export type FeedbackIssueCategory = z.infer<typeof FeedbackIssueCategorySchema>;

export const TranslationFeedbackSchema = z
  .object({
    id: IdentifierSchema,
    sessionId: IdentifierSchema,
    utteranceId: IdentifierSchema.optional(),
    assetId: IdentifierSchema.optional(),
    reporterRole: z.enum(["staff", "visitor", "deaf_reviewer"]),
    issueCategory: FeedbackIssueCategorySchema,
    severity: z.enum(["low", "medium", "high", "critical"]),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type TranslationFeedback = z.infer<typeof TranslationFeedbackSchema>;

export const UsageEventKindSchema = z.enum([
  "session_started",
  "session_completed",
  "transcription_completed",
  "intent_candidate_created",
  "fallback_selected",
  "staff_decision",
  "playback_started",
  "playback_completed",
  "playback_failed",
  "agent_run",
]);
export type UsageEventKind = z.infer<typeof UsageEventKindSchema>;

export const UsageEventSchema = z
  .object({
    id: IdentifierSchema,
    siteId: IdentifierSchema,
    sessionId: IdentifierSchema.optional(),
    kind: UsageEventKindSchema,
    flow: z.enum(["live", "upload", "typed", "manual", "operations"]),
    occurredAt: IsoTimestampSchema,
    durationMs: z.number().int().nonnegative().optional(),
    modelsExecuted: z.array(
      z
        .object({
          provider: z.enum(["google-cloud-speech-v2", "google-gemini"]),
          model: z.string().min(1).max(128),
          invocationId: IdentifierSchema,
        })
        .strict(),
    ),
    intentId: ReceptionIntentIdSchema.optional(),
    assetId: IdentifierSchema.optional(),
    fallbackReason: UnsupportedReasonCodeSchema.optional(),
    staffDecision: z.enum(["play", "fallback", "not_presented"]).optional(),
    playbackResult: z.enum(["completed", "failed", "not_started"]).optional(),
  })
  .strict();
export type UsageEvent = z.infer<typeof UsageEventSchema>;
