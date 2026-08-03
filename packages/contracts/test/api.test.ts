import { describe, expect, it } from "vitest";

import {
  AudioTranscriptionResponseSchema,
  AudioTranscriptionQuerySchema,
  DecisionResponseSchema,
  DecisionRequestSchema,
  DetectedIntentSchema,
  FeedbackRequestSchema,
  LiveSessionConfigSchema,
  LiveServerEventSchema,
} from "../src/index.js";

const now = "2026-08-01T12:00:00.000Z";
const partial = {
  id: "segment-1",
  sessionId: "session-1",
  sequence: 0,
  state: "partial" as const,
  text: "Wel",
  startMs: 0,
  endMs: 250,
  provider: "google-cloud-speech-v2" as const,
  model: "chirp_3",
  receivedAt: now,
};

describe("websocket contracts", () => {
  it.each(["captions_only", "asl_captions", "avatar_captions"] as const)(
    "accepts the explicit %s output lane",
    (outputLane) => {
      expect(LiveSessionConfigSchema.safeParse({
        type: "session.configure",
        sessionId: "session-1",
        siteId: "site-1",
        locale: "en-US",
        consentVersion: "v1",
        outputLane,
        audio: { encoding: "LINEAR16", sampleRateHertz: 16_000, channelCount: 1 },
        retention: "none",
      }).success).toBe(true);
    },
  );

  it("rejects a missing or unknown live output lane", () => {
    const base = {
      type: "session.configure",
      sessionId: "session-1",
      siteId: "site-1",
      locale: "en-US",
      consentVersion: "v1",
      audio: { encoding: "LINEAR16", sampleRateHertz: 16_000, channelCount: 1 },
      retention: "none",
    };
    expect(LiveSessionConfigSchema.safeParse(base).success).toBe(false);
    expect(LiveSessionConfigSchema.safeParse({ ...base, outputLane: "automatic_asl" }).success).toBe(false);
  });

  it("keeps provisional and final transcript event types distinct", () => {
    expect(LiveServerEventSchema.safeParse({ type: "transcript.partial", segment: partial }).success).toBe(true);
    expect(LiveServerEventSchema.safeParse({ type: "transcript.final", segment: partial }).success).toBe(false);
  });

  it("rejects an intent event whose candidate references another utterance", () => {
    expect(
      LiveServerEventSchema.safeParse({
        type: "intent.candidate",
        utterance: {
          id: "utterance-1",
          sessionId: "session-1",
          segmentIds: ["segment-1"],
          transcript: "Welcome",
          isFinal: true,
          finalizationReason: "asr_is_final",
          finalizedAt: now,
        },
        detectedIntent: {
          id: "candidate-1",
          utteranceId: "utterance-2",
          status: "supported",
          intentId: "greeting",
          reasonCode: "matched_supported_intent",
          execution: { route: "gemini", model: "gemini-3.6-flash", invocationId: "invoke-1" },
          requiresHumanConfirmation: true,
          classifiedAt: now,
        },
      }).success,
    ).toBe(false);
  });
});

describe("REST payload contracts", () => {
  it("accepts only one strict upload output-lane query parameter", () => {
    expect(AudioTranscriptionQuerySchema.safeParse({ outputLane: "captions_only" }).success).toBe(true);
    expect(AudioTranscriptionQuerySchema.safeParse({ outputLane: "avatar_captions" }).success).toBe(true);
    expect(AudioTranscriptionQuerySchema.safeParse({ outputLane: "automatic_asl" }).success).toBe(false);
    expect(AudioTranscriptionQuerySchema.safeParse({ outputLane: "asl_captions", assetId: "attacker" }).success).toBe(false);
  });

  it("rejects partials in uploaded-audio finalized responses", () => {
    expect(
      AudioTranscriptionResponseSchema.safeParse({
        outputLane: "asl_captions",
        session: {
          id: "session-1",
          siteId: "site-1",
          mode: "upload",
          locale: "en-US",
          consentVersion: "v1",
          audio: { encoding: "MP3", sampleRateHertz: 44_100, channelCount: 1 },
          lifecycle: "complete",
          retention: "none",
          createdAt: now,
          endedAt: now,
        },
        segments: [partial],
        stableUtterances: [],
        detectedIntents: [],
      }).success,
    ).toBe(false);
  });

  it("does not let the browser supply an asset or arbitrary intent in a play decision", () => {
    expect(DecisionRequestSchema.safeParse({ decision: "play", detectedIntentId: "candidate-1" }).success).toBe(true);
    expect(
      DecisionRequestSchema.safeParse({
        decision: "play",
        detectedIntentId: "candidate-1",
        intentId: "greeting",
        assetId: "attacker-selected-asset",
      }).success,
    ).toBe(false);
  });

  it("rejects a render payload whose caption differs from the finalized sign plan", () => {
    expect(
      DecisionResponseSchema.safeParse({
        status: "ready",
        signPlan: {
          id: "plan-1",
          utteranceId: "utterance-1",
          intentId: "greeting",
          assetId: "asset-1",
          catalogVersion: "pilot-v1",
          languagePack: "ase-US",
          caption: "Welcome",
          approvalProvenance: {
            reviewerRef: "private:reviewers/reviewer-001",
            reviewedSha256: "a".repeat(64),
            rightsRef: "private:rights/release-001",
            reviewedAt: now,
          },
          fallbackRule: "captions_only",
          wholeUtterance: true,
          staffConfirmation: "required",
          createdAt: now,
        },
        renderSegment: {
          id: "render-1",
          signPlanId: "plan-1",
          utteranceId: "utterance-1",
          assetId: "asset-1",
          caption: "A different caption",
          videoUrl: "https://assets.example.test/greeting.mp4",
          urlExpiresAt: "2026-08-01T12:05:00.000Z",
          playbackRate: 1,
          playbackState: "ready",
          objectFit: "contain",
          mirrored: false,
          captionsVisible: true,
        },
      }).success,
    ).toBe(false);
  });

  it("accepts structured feedback but rejects unrestricted text", () => {
    const feedback = {
      sessionId: "session-1",
      reporterRole: "staff",
      issueCategory: "wrong_context",
      severity: "high",
    };
    expect(FeedbackRequestSchema.safeParse(feedback).success).toBe(true);
    expect(FeedbackRequestSchema.safeParse({ ...feedback, comment: "raw visitor transcript" }).success).toBe(false);
  });

  it("requires supported candidates to record an actual Gemini invocation", () => {
    expect(
      DetectedIntentSchema.safeParse({
        id: "candidate-1",
        utteranceId: "utterance-1",
        status: "supported",
        intentId: "greeting",
        reasonCode: "matched_supported_intent",
        execution: { route: "deterministic", model: null, invocationId: null },
        requiresHumanConfirmation: true,
        classifiedAt: now,
      }).success,
    ).toBe(false);
  });
});
