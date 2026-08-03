import {
  AvatarAuthorizationResponseSchema,
  AvatarDraftCreateResponseSchema,
  AvatarExecutionEventResponseSchema,
  type AvatarMessageSource,
} from "@signbridge/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MemoryAvatarExecutionGrantStore,
  verifyAvatarAuthorizationId,
} from "./avatar-execution-grants.js";
import { authenticate, makeTestApp } from "./test-helpers.js";

type TestApp = Awaited<ReturnType<typeof makeTestApp>>["app"];

const apps: TestApp[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("server-owned experimental avatar drafts", () => {
  it("requires a configured provider before accepting transcript text", async () => {
    const { app } = await makeTestApp();
    apps.push(app);
    const session = await authenticate(app);

    const response = await createDraftResponse(app, session.cookie);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "avatar_unavailable" });
  });

  it("creates a normalized, five-minute, session-bound draft and removes the old route", async () => {
    const { app, dependencies, events } = await makeTestApp({
      config: { handtalkToken: "test-token" },
    });
    apps.push(app);
    const session = await authenticate(app);
    const rawText = "  The meeting   moved to Tuesday afternoon  ";
    const normalizedText = "The meeting moved to Tuesday afternoon";
    const startedAt = Date.now();

    const response = await createDraftResponse(app, session.cookie, rawText);

    expect(response.statusCode).toBe(200);
    const draft = AvatarDraftCreateResponseSchema.parse(response.json());
    expect(draft).toMatchObject({
      accepted: true,
      draftId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      text: normalizedText,
    });
    if (!draft.accepted) throw new Error("expected avatar draft");
    expect(Date.parse(draft.expiresAt)).toBeGreaterThanOrEqual(startedAt + 5 * 60_000);
    expect(Date.parse(draft.expiresAt)).toBeLessThanOrEqual(Date.now() + 5 * 60_000);

    const decision = await decideDraft(app, session.cookie, draft.draftId, "play");
    expect(decision.statusCode).toBe(200);
    const authorization = AvatarAuthorizationResponseSchema.parse(decision.json());
    expect(authorization).toMatchObject({
      allowed: true,
      provider: "handtalk",
      text: normalizedText,
    });
    if (!authorization.allowed) throw new Error("expected avatar authorization");
    expect(verifyAvatarAuthorizationId(
      authorization.authorizationId,
      session.sessionId,
      dependencies.config.sessionSecret,
      { normalizedText },
    )).not.toBeNull();
    expect(JSON.stringify(events.events)).not.toContain(rawText);
    expect(JSON.stringify(events.events)).not.toContain(normalizedText);

    const removedRoute = await app.inject({
      method: "POST",
      url: "/api/avatar/authorize",
      headers: { cookie: session.cookie },
      payload: {
        text: normalizedText,
        locale: "en-US",
        source: "type",
        staffConfirmed: true,
      },
    });
    expect(removedRoute.statusCode).toBe(404);
  });

  it.each([
    ["Please call an ambulance", "high_stakes_content"],
    ["My name is Alexandra Smith", "name_or_number_heavy"],
  ])("rejects unsafe draft text before a staff decision: %s", async (text, reasonCode) => {
    const { app, events } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);

    const response = await createDraftResponse(app, session.cookie, text, "speech");

    expect(response.statusCode).toBe(200);
    expect(AvatarDraftCreateResponseSchema.parse(response.json())).toEqual({
      accepted: false,
      reasonCode,
    });
    expect(events.events).toContainEqual(expect.objectContaining({
      type: "fallback",
      flow: "live",
      fallbackReason: reasonCode,
    }));
    expect(events.events.some((event) => event.type === "staff_decision")).toBe(false);
    expect(events.events.some((event) => event.type === "avatar_authorized")).toBe(false);
    expect(JSON.stringify(events.events)).not.toContain(text);
  });

  it("does not let another authenticated session consume a draft", async () => {
    const { app } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const owner = await authenticate(app);
    const otherSession = await authenticate(app);
    const draft = await createDraft(app, owner.cookie);

    const foreignDecision = await decideDraft(app, otherSession.cookie, draft.draftId, "play");
    expect(foreignDecision.statusCode).toBe(409);
    expect(foreignDecision.json()).toEqual({ error: "avatar_draft_not_available" });

    const ownerDecision = await decideDraft(app, owner.cookie, draft.draftId, "play");
    expect(ownerDecision.statusCode).toBe(200);
    expect(AvatarAuthorizationResponseSchema.parse(ownerDecision.json())).toMatchObject({
      allowed: true,
    });
  });

  it("consumes a played draft exactly once", async () => {
    const { app, events } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);
    const draft = await createDraft(app, session.cookie);

    const first = await decideDraft(app, session.cookie, draft.draftId, "play");
    const replay = await decideDraft(app, session.cookie, draft.draftId, "fallback");

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toEqual({ error: "avatar_draft_not_available" });
    expect(events.events.filter((event) => event.type === "staff_decision")).toHaveLength(1);
    expect(events.events.filter((event) => event.type === "avatar_authorized")).toHaveLength(1);
  });

  it("consumes a fallback decision without issuing an execution grant", async () => {
    const { app, events } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);
    const draft = await createDraft(app, session.cookie, "Please wait in the lobby", "phrase");

    const fallback = await decideDraft(app, session.cookie, draft.draftId, "fallback");
    const replay = await decideDraft(app, session.cookie, draft.draftId, "play");

    expect(fallback.statusCode).toBe(200);
    expect(AvatarAuthorizationResponseSchema.parse(fallback.json())).toEqual({
      allowed: false,
      reasonCode: "staff_rejected",
    });
    expect(replay.statusCode).toBe(409);
    expect(events.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "staff_decision",
        flow: "manual",
        staffDecision: "fallback",
      }),
      expect.objectContaining({
        type: "fallback",
        flow: "manual",
        fallbackReason: "staff_rejected",
      }),
    ]));
    expect(events.events.some((event) => event.type === "avatar_authorized")).toBe(false);
  });

  it.each(["forged!draft", "00000000-0000-4000-8000-000000000000"])(
    "returns the same unavailable response for a forged or unknown draft ID: %s",
    async (draftId) => {
      const { app } = await makeTestApp({ config: { handtalkToken: "test-token" } });
      apps.push(app);
      const session = await authenticate(app);

      const response = await decideDraft(app, session.cookie, draftId, "play");

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "avatar_draft_not_available" });
    },
  );

  it("rejects an expired draft without authorizing provider execution", async () => {
    const nowMs = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    const { app, events } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);
    const draft = await createDraft(app, session.cookie);
    now.mockReturnValue(nowMs + 5 * 60_000);

    const response = await decideDraft(app, session.cookie, draft.draftId, "play");

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "avatar_draft_not_available" });
    expect(events.events.some((event) => event.type === "avatar_authorized")).toBe(false);
  });

  it("does not consume a draft when the decision payload is invalid", async () => {
    const { app } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);
    const draft = await createDraft(app, session.cookie);

    const invalid = await app.inject({
      method: "POST",
      url: `/api/avatar/drafts/${encodeURIComponent(draft.draftId)}/decision`,
      headers: { cookie: session.cookie },
      payload: { decision: "approve" },
    });
    const valid = await decideDraft(app, session.cookie, draft.draftId, "play");

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "invalid_avatar_decision" });
    expect(valid.statusCode).toBe(200);
  });
});

describe("avatar execution lifecycle", () => {
  it("accepts one started event followed by one completed event", async () => {
    const { app, events } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);
    const authorization = await authorizeAvatar(app, session.cookie);

    const started = await recordAvatarEvent(
      app,
      session.cookie,
      authorization.authorizationId,
      "started",
    );
    const completed = await recordAvatarEvent(
      app,
      session.cookie,
      authorization.authorizationId,
      "completed",
      420,
    );

    expect(started.statusCode).toBe(202);
    expect(completed.statusCode).toBe(202);
    expect(AvatarExecutionEventResponseSchema.parse(completed.json())).toEqual({ accepted: true });
    expect(events.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "avatar_authorized",
        flow: "typed",
        avatarProvider: "handtalk",
        avatarAuthorizationId: authorization.authorizationId,
      }),
      expect.objectContaining({
        type: "avatar_execution",
        avatarResult: "started",
        avatarAuthorizationId: authorization.authorizationId,
      }),
      expect.objectContaining({
        type: "avatar_execution",
        avatarResult: "completed",
        avatarLatencyMs: 420,
        avatarAuthorizationId: authorization.authorizationId,
      }),
    ]));
  });

  it("accepts a failed terminal event before started for pre-motion failures", async () => {
    const { app, events } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);
    const authorization = await authorizeAvatar(app, session.cookie);

    const failed = await recordAvatarEvent(
      app,
      session.cookie,
      authorization.authorizationId,
      "failed",
      25,
    );

    expect(failed.statusCode).toBe(202);
    expect(events.events.filter((event) => event.type === "avatar_execution")).toEqual([
      expect.objectContaining({ avatarResult: "failed", avatarLatencyMs: 25 }),
    ]);
  });

  it("rejects duplicate started events and completed-before-started without corrupting state", async () => {
    const { app, events } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);
    const authorization = await authorizeAvatar(app, session.cookie);

    const prematureCompleted = await recordAvatarEvent(
      app,
      session.cookie,
      authorization.authorizationId,
      "completed",
    );
    const started = await recordAvatarEvent(
      app,
      session.cookie,
      authorization.authorizationId,
      "started",
    );
    const duplicateStarted = await recordAvatarEvent(
      app,
      session.cookie,
      authorization.authorizationId,
      "started",
    );
    const completed = await recordAvatarEvent(
      app,
      session.cookie,
      authorization.authorizationId,
      "completed",
    );
    const terminalReplay = await recordAvatarEvent(
      app,
      session.cookie,
      authorization.authorizationId,
      "failed",
    );

    expect(prematureCompleted.statusCode).toBe(409);
    expect(started.statusCode).toBe(202);
    expect(duplicateStarted.statusCode).toBe(409);
    expect(completed.statusCode).toBe(202);
    expect(terminalReplay.statusCode).toBe(409);
    expect(events.events
      .filter((event) => event.type === "avatar_execution")
      .map((event) => event.avatarResult)).toEqual(["started", "completed"]);
  });

  it("rejects execution telemetry from another session", async () => {
    const { app } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const owner = await authenticate(app);
    const otherSession = await authenticate(app);
    const authorization = await authorizeAvatar(app, owner.cookie);

    const response = await recordAvatarEvent(
      app,
      otherSession.cookie,
      authorization.authorizationId,
      "started",
    );

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "avatar_event_not_authorized" });
  });

  it("rejects expired execution grants", () => {
    const nowMs = Date.now();
    const grants = new MemoryAvatarExecutionGrantStore(
      "test-session-secret-that-is-long-enough",
    );
    const authorizationId = grants.issue(
      "session-test",
      "The meeting moved to Tuesday afternoon",
      nowMs,
    );

    expect(grants.acceptEvent(
      authorizationId,
      "session-test",
      "started",
      nowMs + 5 * 60_000,
    )).toBe(false);
    grants.dispose();
  });
});

async function createDraftResponse(
  app: TestApp,
  cookie: string,
  text = "The meeting moved to Tuesday afternoon",
  source: AvatarMessageSource = "type",
) {
  return app.inject({
    method: "POST",
    url: "/api/avatar/drafts",
    headers: { cookie },
    payload: { text, locale: "en-US", source },
  });
}

async function createDraft(
  app: TestApp,
  cookie: string,
  text = "The meeting moved to Tuesday afternoon",
  source: AvatarMessageSource = "type",
) {
  const response = await createDraftResponse(app, cookie, text, source);
  expect(response.statusCode).toBe(200);
  const draft = AvatarDraftCreateResponseSchema.parse(response.json());
  if (!draft.accepted) throw new Error("expected avatar draft");
  return draft;
}

function decideDraft(
  app: TestApp,
  cookie: string,
  draftId: string,
  decision: "play" | "fallback",
) {
  return app.inject({
    method: "POST",
    url: `/api/avatar/drafts/${encodeURIComponent(draftId)}/decision`,
    headers: { cookie },
    payload: { decision },
  });
}

async function authorizeAvatar(app: TestApp, cookie: string) {
  const draft = await createDraft(app, cookie);
  const response = await decideDraft(app, cookie, draft.draftId, "play");
  expect(response.statusCode).toBe(200);
  const authorization = AvatarAuthorizationResponseSchema.parse(response.json());
  if (!authorization.allowed) throw new Error("expected avatar authorization");
  return authorization;
}

function recordAvatarEvent(
  app: TestApp,
  cookie: string,
  authorizationId: string,
  result: "started" | "completed" | "failed",
  latencyMs?: number,
) {
  return app.inject({
    method: "POST",
    url: "/api/avatar/events",
    headers: { cookie },
    payload: {
      authorizationId,
      result,
      ...(latencyMs != null ? { latencyMs } : {}),
    },
  });
}
