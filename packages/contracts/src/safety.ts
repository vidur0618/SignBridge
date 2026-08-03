import { z } from "zod";

import { LocaleSchema } from "./common.js";
import { UnsupportedReasonCodeSchema, type UnsupportedReasonCode } from "./intents.js";

export const SafetyGateInputSchema = z
  .object({
    text: z.string().max(2_000),
    locale: z.string().min(2).max(35),
    isFinal: z.boolean(),
  })
  .strict();
export type SafetyGateInput = z.infer<typeof SafetyGateInputSchema>;

export const SafetyGateResultSchema = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(true), normalizedText: z.string().min(1).max(500) }).strict(),
  z
    .object({
      allowed: z.literal(false),
      reasonCode: UnsupportedReasonCodeSchema,
    })
    .strict(),
]);
export type SafetyGateResult = z.infer<typeof SafetyGateResultSchema>;

export const AvatarSafetyGateInputSchema = z
  .object({
    text: z.string().max(1_000),
    locale: z.string().min(2).max(35),
    isFinal: z.boolean(),
  })
  .strict();
export type AvatarSafetyGateInput = z.infer<typeof AvatarSafetyGateInputSchema>;

export const AvatarSafetyGateResultSchema = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(true), normalizedText: z.string().min(1).max(1_000) }).strict(),
  z
    .object({
      allowed: z.literal(false),
      reasonCode: UnsupportedReasonCodeSchema,
    })
    .strict(),
]);
export type AvatarSafetyGateResult = z.infer<typeof AvatarSafetyGateResultSchema>;

const HIGH_STAKES_PATTERNS = [
  /\b(?:emergenc(?:y|ies)|911|ambulance|fire|smoke|evacuat(?:e|ion)|lockdown|active\s+shooter|shoot(?:er|ing)?|gun|firearm|weapon|knife|bomb|explosive)\b/i,
  /\b(?:doctor|nurse|hospital|medical|medicine|medication|prescription|allerg(?:y|ic)|diagnos(?:is|e)|heart\s+attack|stroke|seizure|pain|bleed(?:ing)?|unconscious|can(?:not|'t)\s+breathe|injur(?:y|ed))\b/i,
  /\b(?:lawyer|attorney|legal|court|lawsuit|police|arrest|warrant|subpoena)\b/i,
  /\b(?:security|password|passcode|pin|badge|access\s+code|restricted\s+area)\b/i,
  /\b(?:pay(?:ment)?|credit\s+card|debit\s+card|bank|cash|invoice|refund|charge)\b/i,
  /\b(?:social\s+security|ssn|passport|visa|driver'?s?\s+licen[cs]e|date\s+of\s+birth|identity\s+verification|verify\s+(?:your\s+)?(?:identity|id)|show\s+(?:me\s+)?(?:your\s+)?id)\b/i,
  /\b(?:fired|terminated|discrimination|harassment|employment\s+rights?|reasonable\s+accommodation|human\s+resources|\bhr\b)\b/i,
] as const;

const PROMPT_INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|system)\s+instructions?\b/i,
  /\b(?:system|developer)\s+prompt\b/i,
  /\breveal\s+(?:your|the)\s+(?:prompt|instructions?|secrets?)\b/i,
  /\bact\s+as\s+(?:an?|the)\b/i,
] as const;

/**
 * Whole-utterance templates for the ten launch meanings. These expressions are
 * deliberately anchored: recognizing one safe phrase inside a longer unsafe
 * instruction is not enough to enter model classification. A false negative
 * remains usable through captions; a false positive could play the wrong ASL.
 */
const BOUNDED_DOMAIN_PATTERNS = [
  /^(?:(?:hello|hi)(?:[,!]?\s+welcome)?|welcome|good\s+(?:morning|afternoon|evening))(?:\s+to\s+(?:the\s+)?(?:front\s+desk|reception))?[.!]?$/iu,
  /^(?:hello[,!]?\s*)?(?:how\s+(?:may|can)\s+i\s+help(?:\s+you)?|can\s+i\s+help(?:\s+you)?|do\s+you\s+need\s+help)[?.!]?$/iu,
  /^(?:please\s+)?(?:type|write|enter)\s+(?:(?:your\s+)?name\s+and\s+(?:(?:the\s+name\s+of\s+)?(?:your\s+)?host|who\s+you(?:'re|\s+are)\s+(?:seeing|visiting))|who\s+you(?:'re|\s+are)\s+(?:seeing|visiting)\s+and\s+(?:your\s+)?name)[?.!]?$/iu,
  /^(?:(?:i|we)(?:\s+will|'ll)\s+|let\s+me\s+)(?:notify|contact|tell)\s+(?:(?:your|the)\s+host|them)(?:\s+(?:that\s+)?you(?:'re|\s+are)\s+here)?[.!]?$/iu,
  /^(?:please\s+)?(?:wait(?:\s+(?:here|in\s+(?:the\s+)?reception(?:\s+area)?))?|take\s+a\s+seat|have\s+a\s+seat)[.!]?$/iu,
  /^(?:(?:there\s+(?:is|'s)|we\s+(?:have|are\s+experiencing)|it\s+is)\s+)?(?:a\s+)?(?:short|brief|small|slight)\s+delay(?:\s+right\s+now)?(?:[.!]?\s+thank\s+you\s+for\s+waiting)?[.!]?$/iu,
  /^(?:please\s+)?(?:follow|come\s+with)\s+(?:me|us|the\s+staff(?:\s+member)?)[.!]?$/iu,
  /^(?:(?:would\s+you\s+like\s+me\s+to|can\s+i|i\s+can|let\s+me)\s+show\s+you\s+(?:the\s+way|where\s+to\s+go)|i\s+can\s+help\s+you\s+find\s+(?:the\s+way|your\s+destination))[?.!]?$/iu,
  /^(?:(?:please\s+|could\s+you\s+please\s+)?(?:repeat\s+that|say\s+that\s+(?:again|one\s+more\s+time)|try\s+again)|let(?:'s|\s+us)\s+try\s+again)[?.!]?$/iu,
  /^(?:(?:would\s+you\s+prefer\s+to|we\s+can|you\s+can|let(?:'s|\s+us))\s+(?:type|write|use\s+captions?|use\s+another\s+way\s+to\s+communicate)|(?:i|we)\s+can\s+(?:offer|arrange)\s+(?:qualified\s+)?communication\s+support)[?.!]?$/iu,
] as const;

const VARIABLE_NAME_PATTERNS = [
  /\b(?:my\s+name\s+is|i\s+am\s+here\s+to\s+see|i(?:'m|\s+am)\s+meeting\s+with|the\s+host\s+is|ask\s+for)\s+(?:mr\.?|mrs\.?|ms\.?|mx\.?|dr\.?)?\s*[\p{L}'-]{2,}(?:\s+[\p{L}'-]{2,}){0,2}\b/iu,
  /\b(?:notify|contact|tell|call)\s+(?!(?:the|your|my)\s+host\b|them\b|the\s+person\b|someone\b)(?:mr\.?|mrs\.?|ms\.?|mx\.?|dr\.?)?\s*[\p{L}'-]{2,}(?:\s+[\p{L}'-]{2,}){0,2}\b/iu,
  /\b(?:mr\.?|mrs\.?|ms\.?|mx\.?|dr\.?)\s+[\p{L}'-]{2,}\b/iu,
] as const;

const NUMBER_WORD_PATTERN = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|dozen|noon|midnight)\b/iu;

function blocked(reasonCode: UnsupportedReasonCode): Extract<SafetyGateResult, { allowed: false }> {
  return { allowed: false, reasonCode };
}

/**
 * Conservative, deterministic pre-model gate. It never decides an intent; it
 * only determines whether a finalized English utterance is safe and bounded
 * enough to be offered to the enum-only classifier.
 */
export function runSafetyGate(rawInput: SafetyGateInput): SafetyGateResult {
  const input = SafetyGateInputSchema.parse(rawInput);
  if (!input.isFinal) {
    return blocked("partial_transcript");
  }

  const text = input.text.trim().replace(/\s+/g, " ");
  if (!text) {
    return blocked("empty_transcript");
  }
  if (!LocaleSchema.safeParse(input.locale).success) {
    return blocked("unsupported_language");
  }

  const words = text.split(" ");
  const matchText = text.replace(/\u2019/g, "'");
  if (text.length > 500 || words.length > 60) {
    return blocked("transcript_too_long");
  }
  if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(matchText))) {
    return blocked("prompt_injection");
  }
  if (HIGH_STAKES_PATTERNS.some((pattern) => pattern.test(matchText))) {
    return blocked("high_stakes_content");
  }

  const containsVariableContact = /(?:\b\d\b|\d{2,}|@|https?:\/\/|www\.)/i.test(matchText);
  const containsSpecificName = VARIABLE_NAME_PATTERNS.some((pattern) => pattern.test(matchText));
  const textWithoutBoundedRepairIdiom = matchText.replace(/\bone\s+more\s+time\b/giu, "");
  const containsSpokenNumber = NUMBER_WORD_PATTERN.test(textWithoutBoundedRepairIdiom);
  if (containsVariableContact || containsSpecificName || containsSpokenNumber) {
    return blocked("name_or_number_heavy");
  }
  if (!BOUNDED_DOMAIN_PATTERNS.some((pattern) => pattern.test(matchText))) {
    return blocked("out_of_domain");
  }

  return { allowed: true, normalizedText: text };
}

/**
 * Deterministic boundary for the experimental open-input avatar lane. Unlike
 * the reviewed phrase gate, this permits ordinary out-of-domain English, but
 * it still blocks partial, consequential, injected, identity-bearing, and
 * number-heavy messages before any text can be sent to the avatar provider.
 */
export function runAvatarSafetyGate(rawInput: AvatarSafetyGateInput): AvatarSafetyGateResult {
  const input = AvatarSafetyGateInputSchema.parse(rawInput);
  if (!input.isFinal) return blocked("partial_transcript");

  const text = input.text.trim().replace(/\s+/g, " ");
  if (!text) return blocked("empty_transcript");
  if (!LocaleSchema.safeParse(input.locale).success) return blocked("unsupported_language");

  const words = text.split(" ");
  const matchText = text.replace(/\u2019/g, "'");
  if (text.length > 1_000 || words.length > 150) return blocked("transcript_too_long");
  if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(matchText))) {
    return blocked("prompt_injection");
  }
  if (HIGH_STAKES_PATTERNS.some((pattern) => pattern.test(matchText))) {
    return blocked("high_stakes_content");
  }

  const containsVariableContact = /(?:\b\d\b|\d{2,}|@|https?:\/\/|www\.)/i.test(matchText);
  const containsSpecificName = VARIABLE_NAME_PATTERNS.some((pattern) => pattern.test(matchText));
  const textWithoutBoundedRepairIdiom = matchText.replace(/\bone\s+more\s+time\b/giu, "");
  const containsSpokenNumber = NUMBER_WORD_PATTERN.test(textWithoutBoundedRepairIdiom);
  if (containsVariableContact || containsSpecificName || containsSpokenNumber) {
    return blocked("name_or_number_heavy");
  }

  return { allowed: true, normalizedText: text };
}
