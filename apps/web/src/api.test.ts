import { describe, expect, it } from "vitest";
import { normalizeLiveEvent } from "./api.js";

describe("live event normalization", () => {
  it("keeps provisional captions separate from final captions", () => {
    const partial = normalizeLiveEvent({
      type: "transcript.partial",
      segment: { id: "segment-1", state: "partial", text: "Hello, wel" },
    });
    const final = normalizeLiveEvent({
      type: "transcript.final",
      segment: { id: "segment-2", state: "final", text: "Hello, welcome." },
    });

    expect(partial).toEqual({ type: "partial", text: "Hello, wel", utteranceId: "segment-1" });
    expect(final).toEqual({ type: "final", text: "Hello, welcome.", utteranceId: "segment-2" });
  });

  it("maps the server-owned supported candidate and execution evidence", () => {
    const event = normalizeLiveEvent({
      type: "intent.candidate",
      utterance: { id: "utterance-1", transcript: "Please wait here." },
      detectedIntent: {
        id: "detected-1",
        utteranceId: "utterance-1",
        status: "supported",
        intentId: "ask_wait",
        reasonCode: "matched_supported_intent",
        execution: { route: "gemini", model: "gemini-production-model", invocationId: "invocation-1" },
      },
    });

    expect(event).toMatchObject({
      type: "candidate",
      utteranceId: "utterance-1",
      candidate: {
        detectedIntentId: "detected-1",
        utteranceId: "utterance-1",
        supported: true,
        intentId: "ask_wait",
        model: "gemini-production-model",
        invocationId: "invocation-1",
        requiresHumanConfirmation: true,
      },
    });
  });

  it("preserves a fallback reason without inventing a candidate", () => {
    expect(normalizeLiveEvent({
      type: "fallback",
      sessionId: "session-1",
      utteranceId: "utterance-1",
      reasonCode: "high_stakes_content",
    })).toEqual({ type: "fallback", utteranceId: "utterance-1", code: "high_stakes_content" });
  });
});
