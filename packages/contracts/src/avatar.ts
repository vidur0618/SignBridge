import { z } from "zod";

import { HttpsUrlSchema, IdentifierSchema, IsoTimestampSchema } from "./common.js";
import { UnsupportedReasonCodeSchema } from "./intents.js";

export const HandTalkAvatarSchema = z.enum(["HUGO", "MAYA"]);
export type HandTalkAvatar = z.infer<typeof HandTalkAvatarSchema>;

const AvatarRuntimeConfigBaseSchema = z.object({
  provider: z.literal("handtalk"),
  avatar: HandTalkAvatarSchema,
  language: z.literal("enUS"),
  signLanguage: z.literal("en-ase"),
  maxCharacters: z.literal(1_000),
  status: z.literal("experimental"),
});

export const AvatarRuntimeConfigResponseSchema = z.discriminatedUnion("enabled", [
  AvatarRuntimeConfigBaseSchema.extend({
    enabled: z.literal(false),
  }).strict(),
  AvatarRuntimeConfigBaseSchema.extend({
    enabled: z.literal(true),
    token: z.string().min(1).max(8_192),
    sdkUrl: HttpsUrlSchema,
  }).strict(),
]);
export type AvatarRuntimeConfigResponse = z.infer<typeof AvatarRuntimeConfigResponseSchema>;

export const AvatarMessageSourceSchema = z.enum(["speech", "upload", "type", "phrase"]);
export type AvatarMessageSource = z.infer<typeof AvatarMessageSourceSchema>;

export const AvatarDraftCreateRequestSchema = z
  .object({
    text: z.string().min(1).max(1_000),
    locale: z.literal("en-US"),
    source: AvatarMessageSourceSchema,
  })
  .strict();
export type AvatarDraftCreateRequest = z.infer<typeof AvatarDraftCreateRequestSchema>;

export const AvatarDraftCreateResponseSchema = z.discriminatedUnion("accepted", [
  z
    .object({
      accepted: z.literal(true),
      draftId: IdentifierSchema,
      text: z.string().min(1).max(1_000),
      expiresAt: IsoTimestampSchema,
    })
    .strict(),
  z
    .object({
      accepted: z.literal(false),
      reasonCode: UnsupportedReasonCodeSchema,
    })
    .strict(),
]);
export type AvatarDraftCreateResponse = z.infer<typeof AvatarDraftCreateResponseSchema>;

export const AvatarDraftDecisionRequestSchema = z
  .object({ decision: z.enum(["play", "fallback"]) })
  .strict();
export type AvatarDraftDecisionRequest = z.infer<typeof AvatarDraftDecisionRequestSchema>;

export const AvatarAuthorizationResponseSchema = z.discriminatedUnion("allowed", [
  z
    .object({
      allowed: z.literal(true),
      authorizationId: IdentifierSchema,
      provider: z.literal("handtalk"),
      text: z.string().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      allowed: z.literal(false),
      reasonCode: UnsupportedReasonCodeSchema,
    })
    .strict(),
]);
export type AvatarAuthorizationResponse = z.infer<typeof AvatarAuthorizationResponseSchema>;

export const AvatarExecutionEventRequestSchema = z
  .object({
    authorizationId: IdentifierSchema,
    result: z.enum(["started", "completed", "failed"]),
    latencyMs: z.number().int().nonnegative().max(120_000).optional(),
  })
  .strict();
export type AvatarExecutionEventRequest = z.infer<typeof AvatarExecutionEventRequestSchema>;

export const AvatarExecutionEventResponseSchema = z.object({ accepted: z.literal(true) }).strict();
export type AvatarExecutionEventResponse = z.infer<typeof AvatarExecutionEventResponseSchema>;
