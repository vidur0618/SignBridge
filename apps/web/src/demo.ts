import { runSafetyGate } from "@signbridge/contracts";
import type { CatalogIntent, IntentCandidate, IntentId, PublicCatalog } from "./models.js";

export const DEMO_CATALOG: PublicCatalog = {
  version: "demo-catalog-not-published",
  language: "ase-US",
  intents: [
    {
      id: "greeting",
      title: "Welcome",
      description: "Welcome a visitor to the front desk.",
      caption: "Hello, welcome.",
      available: true,
    },
    {
      id: "offer_help",
      title: "Offer help",
      description: "Ask what assistance the visitor needs.",
      caption: "How can I help you?",
      available: true,
    },
    {
      id: "request_name_and_host",
      title: "Ask for name and host",
      description: "Invite the visitor to type their name and who they are meeting.",
      caption: "Please type your name and the name of the person you are meeting.",
      available: true,
    },
    {
      id: "notify_host",
      title: "Notify the host",
      description: "Tell the visitor that staff will contact their host.",
      caption: "I will notify your host that you are here.",
      available: true,
    },
    {
      id: "ask_wait",
      title: "Please wait",
      description: "Ask the visitor to wait in the reception area.",
      caption: "Please wait here.",
      available: true,
    },
    {
      id: "explain_short_delay",
      title: "Explain a delay",
      description: "Explain that there is a short delay.",
      caption: "There is a short delay. Thank you for waiting.",
      available: true,
    },
    {
      id: "follow_staff",
      title: "Follow me",
      description: "Ask the visitor to follow a staff member.",
      caption: "Please follow me.",
      available: true,
    },
    {
      id: "offer_directions",
      title: "Offer directions",
      description: "Offer to show the visitor where to go.",
      caption: "I can show you where to go.",
      available: true,
    },
    {
      id: "repeat_communication",
      title: "Repeat",
      description: "Acknowledge a request to communicate again.",
      caption: "Please repeat that.",
      available: true,
    },
    {
      id: "offer_alternatives",
      title: "Other communication options",
      description: "Offer typing, captions, or communication support.",
      caption: "Would you prefer to type?",
      available: true,
    },
  ],
};

const RULES: Array<{ id: IntentId; pattern: RegExp }> = [
  { id: "request_name_and_host", pattern: /\b(type|write).*(name|meeting)|\bname.*(host|meeting)\b/i },
  { id: "notify_host", pattern: /\b(let|tell|notify|call).*(know|here|host|them)\b/i },
  { id: "ask_wait", pattern: /\b(wait|seat|sit)\b/i },
  { id: "explain_short_delay", pattern: /\b(delay|running late|few minutes|shortly)\b/i },
  { id: "follow_staff", pattern: /\bfollow\b/i },
  { id: "offer_directions", pattern: /\b(show|directions?|where to go|take you)\b/i },
  { id: "repeat_communication", pattern: /\b(repeat|again|one more time)\b/i },
  { id: "offer_alternatives", pattern: /\b(type|captions?|interpreter|communication support|other way)\b/i },
  { id: "greeting", pattern: /\b(hello|hi|welcome|good morning|good afternoon)\b/i },
  { id: "offer_help", pattern: /\b(help|assist|what do you need|how may i)\b/i },
];

export function getIntent(id: string, catalog: PublicCatalog = DEMO_CATALOG): CatalogIntent | undefined {
  return catalog.intents.find((intent) => intent.id === id);
}

export function classifyDemoTranscript(transcript: string): IntentCandidate {
  const normalized = transcript.trim();
  const base = {
    detectedIntentId: `demo-detected-${Date.now().toString(36)}`,
    utteranceId: `demo-${Date.now().toString(36)}`,
    transcript: normalized,
    requiresHumanConfirmation: true as const,
  };

  const safety = runSafetyGate({ text: normalized, locale: "en-US", isFinal: true });
  if (!safety.allowed) return { ...base, supported: false, reasonCode: safety.reasonCode };

  const rule = RULES.find((candidate) => candidate.pattern.test(safety.normalizedText));
  const intent = rule ? getIntent(rule.id) : undefined;
  if (!intent) {
    return { ...base, supported: false, reasonCode: "outside_pilot_domain" };
  }

  return {
    ...base,
    supported: true,
    intentId: intent.id,
    title: intent.title,
    description: intent.description,
    reasonCode: "demo_rule_match",
  };
}

export const DEMO_TRANSCRIPT = "Hello, welcome.";

export function validateAudioFile(file: Pick<File, "name" | "size" | "type">): string | null {
  if (file.size > 10 * 1024 * 1024) return "Choose a file smaller than 10 MB.";
  const extension = file.name.split(".").pop()?.toLowerCase();
  const supportedExtension = extension === "wav" || extension === "mp3" || extension === "webm";
  const supportedMime = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/webm"].includes(file.type);
  if (!supportedExtension && !supportedMime) return "Choose a WAV, MP3, or WebM audio file.";
  return null;
}
