import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAvatarDraft,
  decideAvatarDraft,
  loadAvatarConfig,
  normalizeLiveEvent,
  transcribeAudio,
} from "./api.js";

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

describe("server-owned avatar drafts", () => {
  it("creates a draft without claiming staff confirmation or contacting the legacy route", async () => {
    const payload = {
      accepted: true,
      draftId: "avatar-draft-1",
      text: "Please wait here.",
      expiresAt: "2026-08-02T21:05:00.000Z",
    };
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>): Promise<Response> => new Response(
      JSON.stringify(payload),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAvatarDraft("  Please wait here.  ", "type")).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/avatar/drafts",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          text: "  Please wait here.  ",
          locale: "en-US",
          source: "type",
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).not.toBe("/api/avatar/authorize");
  });

  it("preserves a server safety rejection as captions-only data", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>): Promise<Response> => new Response(
      JSON.stringify({ accepted: false, reasonCode: "high_stakes_content" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAvatarDraft("Take this medicine now.", "speech")).resolves.toEqual({
      accepted: false,
      reasonCode: "high_stakes_content",
    });
  });

  it("consumes a server draft through an encoded play decision", async () => {
    const payload = {
      allowed: true,
      authorizationId: "avatar-auth-1",
      provider: "handtalk",
      text: "Please wait here.",
    };
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>): Promise<Response> => new Response(
      JSON.stringify(payload),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(decideAvatarDraft("draft/with?reserved", "play")).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/avatar/drafts/draft%2Fwith%3Freserved/decision",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ decision: "play" }),
      }),
    );
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

describe("uploaded-audio output lane", () => {
  it("requests the selected lane and accepts a stable caption without inventing a candidate", async () => {
    const now = "2026-08-02T20:00:00.000Z";
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>): Promise<Response> => new Response(
      JSON.stringify({
        outputLane: "avatar_captions",
        session: {
          id: "audio-session-1",
          siteId: "site-1",
          mode: "upload",
          locale: "en-US",
          consentVersion: "v1",
          audio: { encoding: "WAV", sampleRateHertz: 16_000, channelCount: 1 },
          lifecycle: "complete",
          retention: "none",
          createdAt: now,
          endedAt: now,
        },
        segments: [{
          id: "segment-1",
          sessionId: "audio-session-1",
          sequence: 0,
          state: "final",
          text: "Welcome",
          startMs: 0,
          endMs: 500,
          provider: "google-cloud-speech-v2",
          model: "chirp_3",
          receivedAt: now,
        }],
        stableUtterances: [{
          id: "utterance-1",
          sessionId: "audio-session-1",
          segmentIds: ["segment-1"],
          transcript: "Welcome",
          isFinal: true,
          finalizationReason: "asr_is_final",
          finalizedAt: now,
        }],
        detectedIntents: [],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudio(
      new File([new Uint8Array([1, 2, 3])], "sample.wav", { type: "audio/wav" }),
      "avatar_captions",
    );

    expect(result).toEqual({ transcript: "Welcome" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/audio/transcribe?outputLane=avatar_captions",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
  });
});
