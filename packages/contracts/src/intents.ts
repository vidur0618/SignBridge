import { z } from "zod";

/**
 * The only reception meanings the launch product may propose. This list is
 * server-owned: clients can display it, but cannot add candidate meanings.
 */
export const RECEPTION_INTENT_IDS = [
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
] as const;

export const ReceptionIntentIdSchema = z.enum(RECEPTION_INTENT_IDS);
export type ReceptionIntentId = z.infer<typeof ReceptionIntentIdSchema>;

export const RECEPTION_INTENTS = [
  {
    id: "greeting",
    publicDescription: "Welcome or greet a visitor.",
    boundary: "A greeting only; it must not communicate instructions or promises.",
  },
  {
    id: "offer_help",
    publicDescription: "Ask how staff can help with a routine reception need.",
    boundary: "General reception help only; consequential topics require another communication method.",
  },
  {
    id: "request_name_and_host",
    publicDescription: "Ask the visitor to type their name and who they are visiting.",
    boundary: "Request typing only; do not sign a person's name, identity, or other variable detail.",
  },
  {
    id: "notify_host",
    publicDescription: "Say that staff will notify the visitor's host.",
    boundary: "Do not identify the host or promise an arrival time.",
  },
  {
    id: "ask_wait",
    publicDescription: "Ask the visitor to wait in the reception area.",
    boundary: "Do not state a precise wait time or use this during an emergency.",
  },
  {
    id: "explain_short_delay",
    publicDescription: "Explain that there is a short, unspecified delay.",
    boundary: "No exact duration, cause, guarantee, or consequential explanation.",
  },
  {
    id: "follow_staff",
    publicDescription: "Ask the visitor to follow a staff member.",
    boundary: "Routine wayfinding only; not evacuation, security, medical, or legal direction.",
  },
  {
    id: "offer_directions",
    publicDescription: "Offer to show the visitor the way.",
    boundary: "Offer assistance only; do not encode a variable route or destination in the clip.",
  },
  {
    id: "repeat_communication",
    publicDescription: "Ask to repeat or try the communication again.",
    boundary: "A neutral repair request only; do not imply that the visitor is at fault.",
  },
  {
    id: "offer_alternatives",
    publicDescription: "Offer typing, captions, or qualified communication support.",
    boundary: "Do not promise immediate interpreter availability or describe this product as an interpreter.",
  },
] as const satisfies readonly {
  id: ReceptionIntentId;
  publicDescription: string;
  boundary: string;
}[];

export const UNSUPPORTED_REASON_CODES = [
  "partial_transcript",
  "no_final_transcript",
  "empty_transcript",
  "transcript_too_long",
  "unsupported_language",
  "high_stakes_content",
  "name_or_number_heavy",
  "prompt_injection",
  "out_of_domain",
  "unknown_intent",
  "model_timeout",
  "model_unavailable",
  "model_schema_invalid",
  "staff_rejected",
  "staff_selected_fallback",
  "asset_unavailable",
  "asset_unapproved",
  "asset_withdrawn",
  "asset_hash_mismatch",
  "rights_missing",
  "review_missing",
  "playback_failure",
  "invalid_audio",
  "audio_too_long",
  "rate_limited",
  "session_expired",
] as const;

export const UnsupportedReasonCodeSchema = z.enum(UNSUPPORTED_REASON_CODES);
export type UnsupportedReasonCode = z.infer<typeof UnsupportedReasonCodeSchema>;
