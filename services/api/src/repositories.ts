import { randomUUID } from "node:crypto";
import { Firestore, Timestamp } from "@google-cloud/firestore";
import type { AppConfig } from "./config.js";
import type { RevocationRepository } from "./adapters/revocations.js";
import { AssetRevocationRegistrySchema, type AssetRevocationRegistry } from "@signbridge/contracts";
import type {
  AggregateMetrics,
  OperationsReport,
  PendingDecision,
  PlaybackGrant,
  UsageEvent,
} from "./domain.js";

export interface PendingDecisionRepository {
  put(decision: PendingDecision): Promise<void>;
  consume(
    utteranceId: string,
    sessionId: string,
    decision: "play" | "fallback",
    detectedIntentId?: string,
  ): Promise<PendingDecision | null>;
}

export interface EventRepository {
  record(event: UsageEvent): Promise<void>;
  metrics(since: Date, until?: Date): Promise<AggregateMetrics>;
  saveOperationsReport(report: OperationsReport, siteId: string): Promise<void>;
}

export interface PlaybackGrantRepository {
  put(grant: PlaybackGrant): Promise<void>;
  record(
    utteranceId: string,
    assetId: string,
    sessionId: string,
    result: "started" | "completed" | "failed",
  ): Promise<boolean>;
}

export class MemoryPlaybackGrantRepository implements PlaybackGrantRepository {
  readonly #grants = new Map<string, PlaybackGrant>();

  async put(grant: PlaybackGrant): Promise<void> {
    this.#grants.set(grant.utteranceId, structuredClone(grant));
  }

  async record(
    utteranceId: string,
    assetId: string,
    sessionId: string,
    result: "started" | "completed" | "failed",
  ): Promise<boolean> {
    const grant = this.#grants.get(utteranceId);
    if (
      !grant ||
      grant.assetId !== assetId ||
      grant.sessionId !== sessionId ||
      Date.parse(grant.expiresAt) <= Date.now() ||
      grant.terminalResult
    ) {
      return false;
    }
    if (result !== "started") {
      this.#grants.set(utteranceId, { ...grant, terminalResult: result });
    }
    return true;
  }
}

export class MemoryPendingDecisionRepository implements PendingDecisionRepository {
  readonly records = new Map<string, PendingDecision>();
  readonly #expiryTimers = new Map<string, NodeJS.Timeout>();

  async put(decision: PendingDecision): Promise<void> {
    this.#delete(decision.utteranceId);
    this.records.set(decision.utteranceId, structuredClone(decision));
    const delayMs = Math.max(0, Date.parse(decision.expiresAt) - Date.now());
    const timer = setTimeout(() => {
      const current = this.records.get(decision.utteranceId);
      if (current?.expiresAt === decision.expiresAt) this.records.delete(decision.utteranceId);
      this.#expiryTimers.delete(decision.utteranceId);
    }, delayMs);
    timer.unref();
    this.#expiryTimers.set(decision.utteranceId, timer);
  }

  async consume(
    utteranceId: string,
    sessionId: string,
    decision: "play" | "fallback",
    detectedIntentId?: string,
  ): Promise<PendingDecision | null> {
    const current = this.records.get(utteranceId);
    if (!current) return null;
    if (Date.parse(current.expiresAt) <= Date.now()) {
      this.#delete(utteranceId);
      return null;
    }
    if (
      current.sessionId !== sessionId ||
      (detectedIntentId != null && current.detectedIntent.id !== detectedIntentId) ||
      current.decidedAt
    ) return null;
    const consumed: PendingDecision = {
      ...current,
      decision,
      decidedAt: new Date().toISOString(),
    };
    this.#delete(utteranceId);
    return consumed;
  }

  #delete(utteranceId: string): void {
    this.records.delete(utteranceId);
    const timer = this.#expiryTimers.get(utteranceId);
    if (timer) clearTimeout(timer);
    this.#expiryTimers.delete(utteranceId);
  }
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? null;
}

export function aggregateEvents(events: readonly UsageEvent[], since: Date, until = new Date()): AggregateMetrics {
  const fallbackReasons: Record<string, number> = {};
  const intentCounts: Record<string, number> = {};
  const latencies: Record<NonNullable<UsageEvent["latencyKind"]>, number[]> = {
    first_provisional_caption: [],
    final_after_release: [],
    final_to_intent_candidate: [],
    warm_playback_after_confirmation: [],
  };
  for (const event of events) {
    const isFallbackOutcome =
      event.type === "fallback" ||
      (event.type === "transcription_completed" && event.fallbackReason != null);
    if (isFallbackOutcome && event.fallbackReason) {
      fallbackReasons[event.fallbackReason] = (fallbackReasons[event.fallbackReason] ?? 0) + 1;
    }
    if (event.type === "intent_detected" && event.intentId) {
      intentCounts[event.intentId] = (intentCounts[event.intentId] ?? 0) + 1;
    }
    if (event.latencyMs != null && event.latencyKind) latencies[event.latencyKind].push(event.latencyMs);
  }
  return {
    windowStartedAt: since.toISOString(),
    windowEndedAt: until.toISOString(),
    totals: {
      sessions: events.filter((event) => event.type === "session_started").length,
      liveSessions: events.filter(
        (event) => event.type === "transcription_completed" && event.flow === "live",
      ).length,
      uploadSessions: events.filter(
        (event) => event.type === "transcription_completed" && event.flow === "upload",
      ).length,
      transcriptions: events.filter((event) => event.type === "transcription_completed").length,
      supportedCandidates: events.filter(
        (event) => event.type === "intent_detected" && event.intentId != null,
      ).length,
      fallbacks: events.filter(
        (event) =>
          event.type === "fallback" ||
          (event.type === "transcription_completed" && event.fallbackReason != null),
      ).length,
      staffRejections: events.filter(
        (event) => event.type === "staff_decision" && event.staffDecision === "fallback",
      ).length,
      assetUrlsIssued: events.filter((event) => event.type === "asset_url_issued").length,
      playbackFailures: events.filter((event) => event.playbackResult === "failed").length,
      feedback: events.filter((event) => event.type === "feedback_received").length,
      operationsReports: events.filter((event) => event.type === "operations_report").length,
    },
    fallbackReasons,
    intentCounts,
    latencyP95Ms: {
      firstProvisionalCaption: percentile(latencies.first_provisional_caption, 0.95),
      finalAfterRelease: percentile(latencies.final_after_release, 0.95),
      finalToIntentCandidate: percentile(latencies.final_to_intent_candidate, 0.95),
      warmPlaybackAfterConfirmation: percentile(latencies.warm_playback_after_confirmation, 0.95),
    },
  };
}

export class MemoryEventRepository implements EventRepository {
  readonly events: UsageEvent[] = [];
  readonly reports = new Map<string, OperationsReport>();

  async record(event: UsageEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  async metrics(since: Date, until = new Date()): Promise<AggregateMetrics> {
    return aggregateEvents(
      this.events.filter((event) => {
        const time = Date.parse(event.occurredAt);
        return time >= since.getTime() && time <= until.getTime();
      }),
      since,
      until,
    );
  }

  async saveOperationsReport(report: OperationsReport, _siteId: string): Promise<void> {
    if (this.reports.has(report.reportId)) throw new Error("Operations report already exists");
    this.reports.set(report.reportId, structuredClone(report));
  }
}

export class FirestoreRepositories
  implements EventRepository, RevocationRepository
{
  readonly #firestore: Firestore;
  readonly #eventRetentionDays: number;

  constructor(config: AppConfig) {
    if (!config.googleCloudProject) throw new Error("GOOGLE_CLOUD_PROJECT is required for Firestore");
    this.#firestore = new Firestore({
      projectId: config.googleCloudProject,
      databaseId: config.firestoreDatabase,
    });
    this.#eventRetentionDays = config.eventRetentionDays;
  }

  async record(event: UsageEvent): Promise<void> {
    // UsageEvent is deliberately closed: no raw audio, transcript, or free-text field exists.
    await this.#firestore
      .collection("usageEvents")
      .doc(event.eventId)
      .create(toFirestoreUsageEvent(event, this.#eventRetentionDays));
  }

  async metrics(since: Date, until = new Date()): Promise<AggregateMetrics> {
    const snapshot = await this.#firestore
      .collection("usageEvents")
      .where("occurredAt", ">=", since.toISOString())
      .where("occurredAt", "<=", until.toISOString())
      .orderBy("occurredAt", "asc")
      .limit(5_000)
      .get();
    return aggregateEvents(
      snapshot.docs.map((document) => document.data() as UsageEvent),
      since,
      until,
    );
  }

  async saveOperationsReport(report: OperationsReport, siteId: string): Promise<void> {
    const batch = this.#firestore.batch();
    batch.create(this.#firestore.collection("operationsReports").doc(report.reportId), {
      ...report,
      siteId,
    });
    const eventId = randomUUID();
    const event = {
      eventId,
      occurredAt: report.generatedAt,
      siteId,
      sessionId: "operations-agent",
      type: "operations_report",
      reportId: report.reportId,
      ...(report.execution === "gemini" && report.model
        ? {
            classifierProvider: "gemini",
            classifierModel: report.model,
            ...(report.invocationId ? { classifierInvocationId: report.invocationId } : {}),
          }
        : {}),
    } satisfies UsageEvent;
    batch.create(
      this.#firestore.collection("usageEvents").doc(eventId),
      toFirestoreUsageEvent(event, this.#eventRetentionDays),
    );
    await batch.commit();
  }

  async current(): Promise<AssetRevocationRegistry> {
    // Every document is create-only and permanent for one exact asset hash.
    const snapshot = await this.#firestore.collection("assetRevocations").limit(10_000).get();
    return AssetRevocationRegistrySchema.parse({
      schemaVersion: 1,
      immutableEntries: true,
      updatedAt: new Date().toISOString(),
      entries: snapshot.docs.map((document) => document.data()),
    });
  }
}

export function toFirestoreUsageEvent(
  event: UsageEvent,
  retentionDays: number,
): UsageEvent & { expiresAt: Timestamp } {
  const occurredAtMs = Date.parse(event.occurredAt);
  if (!Number.isFinite(occurredAtMs)) throw new Error("Usage event occurredAt must be an ISO timestamp");
  return {
    ...event,
    expiresAt: Timestamp.fromMillis(occurredAtMs + retentionDays * 86_400_000),
  };
}
