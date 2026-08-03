import { z } from "zod";

import {
  IdentifierSchema,
  IsoTimestampSchema,
  LanguagePackSchema,
  LocaleSchema,
  VersionSchema,
} from "./common.js";
import {
  AudioConfigurationSchema,
  AudioSessionSchema,
  DetectedIntentSchema,
  ExperienceModeSchema,
  FeedbackIssueCategorySchema,
  RenderSegmentSchema,
  SignPlanSchema,
  StableUtteranceSchema,
  TranscriptSegmentSchema,
} from "./core.js";
import {
  ReceptionIntentIdSchema,
  UnsupportedReasonCodeSchema,
} from "./intents.js";

export const AccessCodeExchangeRequestSchema = z
  .object({
    accessCode: z.string().min(8).max(128),
    consentVersion: VersionSchema,
  })
  .strict();
export type AccessCodeExchangeRequest = z.infer<typeof AccessCodeExchangeRequestSchema>;

export const AccessCodeExchangeResponseSchema = z
  .object({
    authenticated: z.literal(true),
    sessionId: IdentifierSchema,
    siteId: IdentifierSchema,
    expiresAt: IsoTimestampSchema,
  })
  .strict();
export type AccessCodeExchangeResponse = z.infer<typeof AccessCodeExchangeResponseSchema>;

export const LiveSessionConfigSchema = z
  .object({
    type: z.literal("session.configure"),
    sessionId: IdentifierSchema,
    siteId: IdentifierSchema,
    locale: LocaleSchema,
    consentVersion: VersionSchema,
    outputLane: ExperienceModeSchema,
    audio: AudioConfigurationSchema,
    retention: z.literal("none"),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.audio.encoding !== "LINEAR16" || config.audio.sampleRateHertz !== 16_000) {
      context.addIssue({
        code: "custom",
        path: ["audio"],
        message: "live sessions require 16 kHz mono LINEAR16 PCM",
      });
    }
  });
export type LiveSessionConfig = z.infer<typeof LiveSessionConfigSchema>;

export const LiveClientMessageSchema = z.discriminatedUnion("type", [
  LiveSessionConfigSchema,
  z.object({ type: z.literal("audio.stop"), sessionId: IdentifierSchema }).strict(),
  z.object({ type: z.literal("session.cancel"), sessionId: IdentifierSchema }).strict(),
]);
export type LiveClientMessage = z.infer<typeof LiveClientMessageSchema>;

export const AudioTranscriptionQuerySchema = z
  .object({ outputLane: ExperienceModeSchema })
  .strict();
export type AudioTranscriptionQuery = z.infer<typeof AudioTranscriptionQuerySchema>;

/** Binary WebSocket frames are the only valid audio-chunk payload. */
export const LIVE_AUDIO_BINARY_FRAME_MAX_BYTES = 64 * 1024;

export const LiveServerEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("session.ready"),
      session: AudioSessionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("transcript.partial"),
      segment: TranscriptSegmentSchema.refine((segment) => segment.state === "partial", {
        message: "partial events require a partial segment",
      }),
    })
    .strict(),
  z
    .object({
      type: z.literal("transcript.final"),
      segment: TranscriptSegmentSchema.refine((segment) => segment.state === "final", {
        message: "final events require a final segment",
      }),
    })
    .strict(),
  z
    .object({
      type: z.literal("intent.candidate"),
      utterance: StableUtteranceSchema,
      detectedIntent: DetectedIntentSchema,
    })
    .strict()
    .superRefine((event, context) => {
      if (event.detectedIntent.utteranceId !== event.utterance.id) {
        context.addIssue({
          code: "custom",
          path: ["detectedIntent", "utteranceId"],
          message: "candidate must belong to the finalized utterance",
        });
      }
    }),
  z
    .object({
      type: z.literal("speech_end"),
      sessionId: IdentifierSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("fallback"),
      sessionId: IdentifierSchema,
      utteranceId: IdentifierSchema.optional(),
      reasonCode: UnsupportedReasonCodeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      sessionId: IdentifierSchema.optional(),
      reasonCode: UnsupportedReasonCodeSchema,
      recoverable: z.boolean(),
      message: z.string().min(1).max(240),
    })
    .strict(),
]);
export type LiveServerEvent = z.infer<typeof LiveServerEventSchema>;

export const AudioTranscriptionResponseSchema = z
  .object({
    outputLane: ExperienceModeSchema,
    session: AudioSessionSchema,
    segments: z.array(TranscriptSegmentSchema).max(100),
    stableUtterances: z.array(StableUtteranceSchema).max(100),
    detectedIntents: z.array(DetectedIntentSchema).max(100),
    fallbackReason: UnsupportedReasonCodeSchema.optional(),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.segments.some((segment) => segment.state !== "final")) {
      context.addIssue({
        code: "custom",
        path: ["segments"],
        message: "uploaded-audio responses may contain finalized segments only",
      });
    }
    const utteranceIds = new Set(response.stableUtterances.map((utterance) => utterance.id));
    if (response.detectedIntents.some((candidate) => !utteranceIds.has(candidate.utteranceId))) {
      context.addIssue({
        code: "custom",
        path: ["detectedIntents"],
        message: "every intent candidate must reference a finalized utterance in this response",
      });
    }
  });
export type AudioTranscriptionResponse = z.infer<typeof AudioTranscriptionResponseSchema>;

export const CatalogPublicResponseSchema = z
  .object({
    catalogVersion: VersionSchema,
    status: z.enum(["draft", "published", "retired"]),
    languagePack: LanguagePackSchema,
    playbackEnabled: z.boolean(),
    intents: z.array(
      z
        .object({
          id: ReceptionIntentIdSchema,
          publicDescription: z.string().min(1).max(240),
          boundary: z.string().min(1).max(360),
          available: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export type CatalogPublicResponse = z.infer<typeof CatalogPublicResponseSchema>;

export const DecisionRequestSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("play"),
      detectedIntentId: IdentifierSchema,
    })
    .strict(),
  z
    .object({
      decision: z.literal("fallback"),
      detectedIntentId: IdentifierSchema.optional(),
    })
    .strict(),
]);
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

export const DecisionResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ready"),
      signPlan: SignPlanSchema,
      renderSegment: RenderSegmentSchema,
    })
    .strict()
    .superRefine((response, context) => {
      if (
        response.signPlan.id !== response.renderSegment.signPlanId ||
        response.signPlan.assetId !== response.renderSegment.assetId ||
        response.signPlan.utteranceId !== response.renderSegment.utteranceId ||
        response.signPlan.caption !== response.renderSegment.caption
      ) {
        context.addIssue({
          code: "custom",
          message: "render segment must be derived from the returned sign plan",
        });
      }
    }),
  z
    .object({
      status: z.literal("captions_only"),
      utteranceId: IdentifierSchema,
      reasonCode: UnsupportedReasonCodeSchema,
    })
    .strict(),
]);
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;

export const FeedbackRequestSchema = z
  .object({
    sessionId: IdentifierSchema,
    utteranceId: IdentifierSchema.optional(),
    assetId: IdentifierSchema.optional(),
    reporterRole: z.enum(["staff", "visitor", "deaf_reviewer"]),
    issueCategory: FeedbackIssueCategorySchema,
    severity: z.enum(["low", "medium", "high", "critical"]),
  })
  .strict();
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

export const FeedbackResponseSchema = z
  .object({
    accepted: z.literal(true),
    feedbackId: IdentifierSchema,
  })
  .strict();
export type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;

export const AdminMetricsResponseSchema = z
  .object({
    window: z.object({ from: IsoTimestampSchema, to: IsoTimestampSchema }).strict(),
    totals: z
      .object({
        sessions: z.number().int().nonnegative(),
        liveSessions: z.number().int().nonnegative(),
        uploadSessions: z.number().int().nonnegative(),
        supportedCandidates: z.number().int().nonnegative(),
        fallbacks: z.number().int().nonnegative(),
        staffRejections: z.number().int().nonnegative(),
        playbackFailures: z.number().int().nonnegative(),
        agentRuns: z.number().int().nonnegative(),
      })
      .strict(),
    latencyP95Ms: z
      .object({
        firstProvisionalCaption: z.number().nonnegative().nullable(),
        finalAfterRelease: z.number().nonnegative().nullable(),
        finalToIntentCandidate: z.number().nonnegative().nullable(),
        warmPlaybackAfterConfirmation: z.number().nonnegative().nullable(),
      })
      .strict(),
    fallbackReasons: z.record(UnsupportedReasonCodeSchema, z.number().int().nonnegative()),
    generatedAt: IsoTimestampSchema,
  })
  .strict();
export type AdminMetricsResponse = z.infer<typeof AdminMetricsResponseSchema>;
