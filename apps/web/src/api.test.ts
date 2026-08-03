import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAvatarConfig, normalizeLiveEvent } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("avatar runtime configuration", () => {
  it("loads a token-free disabled configuration with same-origin credentials", async () => {
    const payload = {
      provider: "handtalk",
      enabled: false,
      avatar: "HUGO",
      language: "enUS",
      signLanguage: "en-ase",
      maxCharacters: 1_000,
      status: "experimental",
    };
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>): Promise<Response> => new Response(
      JSON.stringify(payload),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadAvatarConfig()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/avatar/config",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("rejects an invalid disabled response that leaks provider credentials", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>): Promise<Response> => new Response(
      JSON.stringify({
        provider: "handtalk",
        enabled: false,
        token: "must-not-be-returned",
        avatar: "HUGO",
        language: "enUS",
        signLanguage: "en-ase",
        maxCharacters: 1_000,
        status: "experimental",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadAvatarConfig()).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      code: "invalid_contract",
    });
  });
});

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
