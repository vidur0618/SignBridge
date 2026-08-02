import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeSession } from "./security.js";
import {
  authenticate,
  makeTestApp,
  publishedCatalog,
} from "./test-helpers.js";
import type { AppDependencies } from "./app.js";
import type { AuthSession } from "./domain.js";

const apps: Array<Awaited<ReturnType<typeof makeTestApp>>["app"]> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

async function seedGreetingCandidate(
  dependencies: AppDependencies,
  cookie: string,
): Promise<{ utteranceId: string; detectedIntentId: string; auth: AuthSession }> {
  const token = cookie.slice(cookie.indexOf("=") + 1);
  const auth = decodeSession(token, dependencies.config.sessionSecret);
  if (!auth) throw new Error("test session did not decode");
  const session = dependencies.transcription.createAudioSession(auth, "upload", "finalizing", "WAV");
  const segment = dependencies.transcription.toTranscriptSegment(session.id, 0, {
    id: randomUUID(),
    text: "Welcome",
    isFinal: true,
    startedAtMs: 0,
    endedAtMs: 900,
    provider: "google-cloud-speech",
    model: "chirp_3",
  });
  const bundle = await dependencies.transcription.classifyFinalSegments(
    auth,
    session,
    [segment],
    "upload",
  );
  return {
    utteranceId: bundle.utterance.id,
    detectedIntentId: bundle.detectedIntent.id,
    auth,
  };
}

describe("staff decision and playback gates", () => {
  it("does not turn a client-selected manual phrase into an ASL playback grant", async () => {
    const sign = vi.fn();
    const { app } = await makeTestApp({
      catalog: publishedCatalog(),
      assetSigner: { sign },
    });
    apps.push(app);
    const login = await authenticate(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/utterances/${randomUUID()}/decision`,
      headers: { cookie: login.cookie, origin: "http://127.0.0.1:4173" },
      payload: { decision: "play", detectedIntentId: randomUUID() },
    });

    expect(response.statusCode).toBe(404);
    expect(sign).not.toHaveBeenCalled();
  });

  it("keeps a supported candidate captions-only when the catalog is unpublished", async () => {
    const { app, dependencies } = await makeTestApp();
    apps.push(app);
    const login = await authenticate(app);
    const candidate = await seedGreetingCandidate(dependencies, login.cookie);
    const response = await app.inject({
      method: "POST",
      url: `/api/utterances/${candidate.utteranceId}/decision`,
      headers: { cookie: login.cookie, origin: "http://127.0.0.1:4173" },
      payload: { decision: "play", detectedIntentId: candidate.detectedIntentId },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "captions_only",
      reasonCode: "asset_unavailable",
    });
  });

  it("checks the runtime revocation registry immediately before signing", async () => {
    const sign = vi.fn(async () => ({
      url: "https://storage.example/asset.mp4",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }));
    const { app, dependencies } = await makeTestApp({
      catalog: publishedCatalog(),
      assetSigner: { sign },
      revocations: {
        async current() {
          const asset = publishedCatalog().assets[0];
          if (!asset) throw new Error("missing test asset");
          return {
            schemaVersion: 1,
            immutableEntries: true,
            updatedAt: "2026-08-01T12:01:00.000Z",
            entries: [
              {
                assetId: asset.id,
                assetSha256: asset.sha256,
                catalogVersion: "2026-08-01-published.1",
                withdrawnAt: "2026-08-01T12:00:30.000Z",
                withdrawalRef: "withdrawals/test-1",
              },
            ],
          } as const;
        },
      },
    });
    apps.push(app);
    const login = await authenticate(app);
    const candidate = await seedGreetingCandidate(dependencies, login.cookie);
    const response = await app.inject({
      method: "POST",
      url: `/api/utterances/${candidate.utteranceId}/decision`,
      headers: { cookie: login.cookie, origin: "http://127.0.0.1:4173" },
      payload: { decision: "play", detectedIntentId: candidate.detectedIntentId },
    });
    expect(response.json()).toMatchObject({ status: "captions_only", reasonCode: "asset_withdrawn" });
    expect(sign).not.toHaveBeenCalled();
  });

  it("accepts playback telemetry only for an issued session-bound render grant", async () => {
    const { app, dependencies } = await makeTestApp({
      catalog: publishedCatalog(),
      assetSigner: {
        async sign() {
          return {
            url: "https://storage.example/asset.mp4",
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          };
        },
      },
    });
    apps.push(app);
    const login = await authenticate(app);
    const candidate = await seedGreetingCandidate(dependencies, login.cookie);

    const wrong = await app.inject({
      method: "POST",
      url: `/api/utterances/${candidate.utteranceId}/decision`,
      headers: { cookie: login.cookie, origin: "http://127.0.0.1:4173" },
      payload: { decision: "play", detectedIntentId: "wrong-candidate" },
    });
    expect(wrong.statusCode).toBe(404);

    const decision = await app.inject({
      method: "POST",
      url: `/api/utterances/${candidate.utteranceId}/decision`,
      headers: { cookie: login.cookie, origin: "http://127.0.0.1:4173" },
      payload: { decision: "play", detectedIntentId: candidate.detectedIntentId },
    });
    expect(decision.statusCode).toBe(200);
    const render = decision.json<{ renderSegment: { assetId: string } }>().renderSegment;
    const playback = await app.inject({
      method: "POST",
      url: "/api/playback-events",
      headers: { cookie: login.cookie, origin: "http://127.0.0.1:4173" },
      payload: {
        utteranceId: candidate.utteranceId,
        assetId: render.assetId,
        result: "failed",
      },
    });
    expect(playback.statusCode).toBe(202);

    const fabricated = await app.inject({
      method: "POST",
      url: "/api/playback-events",
      headers: { cookie: login.cookie, origin: "http://127.0.0.1:4173" },
      payload: {
        utteranceId: randomUUID(),
        assetId: render.assetId,
        result: "completed",
      },
    });
    expect(fabricated.statusCode).toBe(409);
  });
});
