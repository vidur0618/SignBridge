import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AuthSession } from "./domain.js";
import { MemoryEventRepository, MemoryPendingDecisionRepository } from "./repositories.js";
import { TranscriptionFallbackError, TranscriptionService } from "./transcription-service.js";
import { fakeSpeech, supportedClassifier } from "./test-helpers.js";

const auth: AuthSession = {
  sessionId: "session-test",
  siteId: "test-site",
  role: "site",
  consentVersion: "2026-08-01.1",
  issuedAt: "2026-08-01T12:00:00.000Z",
  expiresAt: "2026-08-01T20:00:00.000Z",
};

describe("transcript privacy and safety", () => {
  it("never sends high-stakes text to Gemini or persists it in usage events", async () => {
    const classifier = supportedClassifier();
    const classify = vi.spyOn(classifier, "classify");
    const events = new MemoryEventRepository();
    const service = new TranscriptionService(
      fakeSpeech,
      classifier,
      new MemoryPendingDecisionRepository(),
      events,
    );
    const session = service.createAudioSession(auth, "upload", "finalizing", "WAV");
    const segment = service.toTranscriptSegment(session.id, 0, {
      id: randomUUID(),
      text: "Call 911, this is a medical emergency",
      isFinal: true,
      startedAtMs: 0,
      endedAtMs: 1_000,
      provider: "google-cloud-speech",
      model: "chirp_3",
    });
    const result = await service.classifyFinalSegments(auth, session, [segment], "upload");
    expect(result.detectedIntent.status).toBe("unsupported");
    expect(result.detectedIntent.reasonCode).toBe("high_stakes_content");
    expect(result.detectedIntent.execution).toEqual({ route: "deterministic", model: null, invocationId: null });
    expect(classify).not.toHaveBeenCalled();
    expect(JSON.stringify(events.events)).not.toContain("medical emergency");
  });

  it("refuses to promote a partial hypothesis", async () => {
    const service = new TranscriptionService(
      fakeSpeech,
      supportedClassifier(),
      new MemoryPendingDecisionRepository(),
      new MemoryEventRepository(),
    );
    const session = service.createAudioSession(auth, "live", "listening", "LINEAR16");
    const segment = service.toTranscriptSegment(session.id, 0, {
      id: randomUUID(),
      text: "Welcome",
      isFinal: false,
      startedAtMs: 0,
      endedAtMs: 200,
      provider: "google-cloud-speech",
      model: "chirp_3",
    });
    await expect(service.classifyFinalSegments(auth, session, [segment], "live")).rejects.toThrow(
      /Partial transcript segments cannot create/,
    );
  });

  it("maps an overlong finalized transcript before StableUtterance construction or Gemini", async () => {
    const classifier = supportedClassifier();
    const classify = vi.spyOn(classifier, "classify");
    const service = new TranscriptionService(
      fakeSpeech,
      classifier,
      new MemoryPendingDecisionRepository(),
      new MemoryEventRepository(),
    );
    const session = service.createAudioSession(auth, "upload", "finalizing", "WAV");
    const segment = service.toTranscriptSegment(session.id, 0, {
      id: randomUUID(),
      text: Array.from({ length: 61 }, () => "hello").join(" "),
      isFinal: true,
      startedAtMs: 0,
      endedAtMs: 1_000,
      provider: "google-cloud-speech",
      model: "chirp_3",
    });

    const rejection = await service.classifyFinalSegments(auth, session, [segment], "upload").catch(
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(TranscriptionFallbackError);
    expect((rejection as TranscriptionFallbackError).reasonCode).toBe("transcript_too_long");
    expect(classify).not.toHaveBeenCalled();
  });
});
