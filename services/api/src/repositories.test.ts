import { Timestamp } from "@google-cloud/firestore";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingDecision, UsageEvent } from "./domain.js";
import { aggregateEvents, MemoryPendingDecisionRepository, toFirestoreUsageEvent } from "./repositories.js";

const start = new Date("2026-08-01T00:00:00.000Z");
const end = new Date("2026-08-02T00:00:00.000Z");

afterEach(() => vi.useRealTimers());

function event(overrides: Partial<UsageEvent>): UsageEvent {
  return {
    eventId: crypto.randomUUID(),
    occurredAt: "2026-08-01T12:00:00.000Z",
    siteId: "test-site",
    sessionId: "test-session",
    type: "latency_sample",
    ...overrides,
  };
}

describe("privacy-safe operational metrics", () => {
  it("counts each terminal flow and fallback once while retaining latency samples", () => {
    const metrics = aggregateEvents(
      [
        event({ type: "latency_sample", flow: "live", latencyKind: "first_provisional_caption", latencyMs: 100 }),
        event({ type: "latency_sample", flow: "live", latencyKind: "final_after_release", latencyMs: 500 }),
        event({ type: "intent_detected", flow: "live", fallbackReason: "out_of_domain" }),
        event({ type: "transcription_completed", flow: "live", fallbackReason: "out_of_domain" }),
        event({ type: "intent_detected", flow: "upload", intentId: "greeting" }),
        event({ type: "transcription_completed", flow: "upload", intentId: "greeting" }),
        event({ type: "fallback", fallbackReason: "staff_selected_fallback" }),
      ],
      start,
      end,
    );

    expect(metrics.totals.liveSessions).toBe(1);
    expect(metrics.totals.uploadSessions).toBe(1);
    expect(metrics.totals.transcriptions).toBe(2);
    expect(metrics.totals.fallbacks).toBe(2);
    expect(metrics.fallbackReasons).toEqual({
      out_of_domain: 1,
      staff_selected_fallback: 1,
    });
    expect(metrics.intentCounts.greeting).toBe(1);
    expect(metrics.latencyP95Ms.firstProvisionalCaption).toBe(100);
    expect(metrics.latencyP95Ms.finalAfterRelease).toBe(500);
  });

  it("adds a Firestore Timestamp that matches the configured retention window", () => {
    const stored = toFirestoreUsageEvent(event({ type: "session_started" }), 30);
    expect(stored.expiresAt).toBeInstanceOf(Timestamp);
    expect(stored.expiresAt.toDate().toISOString()).toBe("2026-08-31T12:00:00.000Z");
    expect(stored).not.toHaveProperty("transcript");
  });

  it("deletes transcript-bearing pending decisions on consumption or expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
    const repository = new MemoryPendingDecisionRepository();
    const pending = {
      utteranceId: "utterance-private-1",
      sessionId: "session-private-1",
      siteId: "test-site",
      intentId: "greeting",
      state: "supported",
      reasonCode: "matched_supported_intent",
      detectedIntent: { id: "intent-private-1" },
      utterance: { transcript: "private caption" },
      createdAt: "2026-08-01T12:00:00.000Z",
      expiresAt: "2026-08-01T12:00:01.000Z",
    } as unknown as PendingDecision;

    await repository.put(pending);
    expect(repository.records.size).toBe(1);
    expect(await repository.consume(
      pending.utteranceId,
      pending.sessionId,
      "fallback",
      pending.detectedIntent.id,
    )).not.toBeNull();
    expect(repository.records.size).toBe(0);

    await repository.put({ ...pending, utteranceId: "utterance-private-2" });
    await vi.advanceTimersByTimeAsync(1_001);
    expect(repository.records.size).toBe(0);
  });
});
