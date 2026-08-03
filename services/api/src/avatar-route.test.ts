import { afterEach, describe, expect, it } from "vitest";
import {
  AvatarAuthorizationResponseSchema,
  AvatarExecutionEventResponseSchema,
} from "@signbridge/contracts";

import {
  MemoryAvatarExecutionGrantStore,
  verifyAvatarAuthorizationId,
} from "./avatar-execution-grants.js";
import { authenticate, makeTestApp } from "./test-helpers.js";

const apps: Array<Awaited<ReturnType<typeof makeTestApp>>["app"]> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("experimental avatar authorization", () => {
  it("requires a configured provider", async () => {
    const { app } = await makeTestApp();
    apps.push(app);
    const session = await authenticate(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/avatar/authorize",
      headers: { cookie: session.cookie },
      payload: {
        text: "The meeting moved to Tuesday afternoon",
        locale: "en-US",
        source: "type",
        staffConfirmed: true,
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "avatar_unavailable" });
  });

  it("binds a route-issued authorization to the exact normalized text without exposing it", async () => {
    const { app, dependencies, events } = await makeTestApp({
      config: { handtalkToken: "test-token" },
    });
    apps.push(app);
    const session = await authenticate(app);
    const rawText = "  The meeting   moved to Tuesday afternoon  ";
    const normalizedText = "The meeting moved to Tuesday afternoon";

    const response = await app.inject({
      method: "POST",
      url: "/api/avatar/authorize",
      headers: { cookie: session.cookie },
      payload: { text: rawText, locale: "en-US", source: "type", staffConfirmed: true },
    });

    expect(response.statusCode).toBe(200);
    const authorization = AvatarAuthorizationResponseSchema.parse(response.json());
    expect(authorization).toMatchObject({
      allowed: true,
      provider: "handtalk",
      text: normalizedText,
    });
    if (!authorization.allowed) throw new Error("expected avatar authorization");
    expect(authorization.authorizationId.length).toBeLessThanOrEqual(128);
    const idParts = authorization.authorizationId.split(".");
    expect(idParts).toEqual([
      expect.stringMatching(/^[a-f0-9]{32}$/),
      expect.stringMatching(/^[0-9a-z]{6,8}$/),
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    ]);
    expect(verifyAvatarAuthorizationId(
      authorization.authorizationId,
      session.sessionId,
      dependencies.config.sessionSecret,
      { normalizedText },
    )).toMatchObject({
      requestId: expect.stringMatching(/^[a-f0-9]{32}$/),
      textHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(verifyAvatarAuthorizationId(
      authorization.authorizationId,
      session.sessionId,
      dependencies.config.sessionSecret,
      { normalizedText: `${normalizedText}.` },
    )).toBeNull();
    expect(verifyAvatarAuthorizationId(
      authorization.authorizationId,
      "another-session",
      dependencies.config.sessionSecret,
      { normalizedText },
    )).toBeNull();
    const requestId = idParts[0];
    if (!requestId) throw new Error("expected request ID");
    const changedFirstCharacter = requestId.startsWith("a") ? "b" : "a";
    const tamperedRequestId = `${changedFirstCharacter}${requestId.slice(1)}`;
    expect(verifyAvatarAuthorizationId(
      [tamperedRequestId, ...idParts.slice(1)].join("."),
      session.sessionId,
      dependencies.config.sessionSecret,
      { normalizedText },
    )).toBeNull();
    expect(JSON.stringify(events.events)).not.toContain(normalizedText);
  });

  it("accepts one started event followed by one completed event", async () => {
    const { app, events } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);
    const authorization = await authorizeAvatar(app, session.cookie);

    const started = await recordAvatarEvent(app, session.cookie, authorization.authorizationId, "started");
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

  it("rejects duplicate started events and records only the accepted transition", async () => {
    const { app, events } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);
    const authorization = await authorizeAvatar(app, session.cookie);

    const first = await recordAvatarEvent(app, session.cookie, authorization.authorizationId, "started");
    const duplicate = await recordAvatarEvent(app, session.cookie, authorization.authorizationId, "started");
    expect(first.statusCode).toBe(202);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({ error: "avatar_event_not_authorized" });
    expect(events.events.filter((event) => event.type === "avatar_execution")).toEqual([
      expect.objectContaining({ avatarResult: "started" }),
    ]);
  });

  it("rejects completed before started without consuming the grant", async () => {
    const { app, events } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);
    const authorization = await authorizeAvatar(app, session.cookie);

    const completed = await recordAvatarEvent(
      app,
      session.cookie,
      authorization.authorizationId,
      "completed",
    );
    const started = await recordAvatarEvent(app, session.cookie, authorization.authorizationId, "started");
    expect(completed.statusCode).toBe(409);
    expect(started.statusCode).toBe(202);
    expect(events.events.filter((event) => event.type === "avatar_execution")).toEqual([
      expect.objectContaining({ avatarResult: "started" }),
    ]);
  });

  it("rejects terminal replay after a completed lifecycle", async () => {
    const { app, events } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);
    const authorization = await authorizeAvatar(app, session.cookie);

    expect((await recordAvatarEvent(
      app,
      session.cookie,
      authorization.authorizationId,
      "started",
    )).statusCode).toBe(202);
    expect((await recordAvatarEvent(
      app,
      session.cookie,
      authorization.authorizationId,
      "completed",
    )).statusCode).toBe(202);
    expect((await recordAvatarEvent(
      app,
      session.cookie,
      authorization.authorizationId,
      "failed",
    )).statusCode).toBe(409);
    expect(events.events.filter((event) => event.type === "avatar_execution").map((event) => event.avatarResult))
      .toEqual(["started", "completed"]);
  });

  it("rejects expired grants", async () => {
    const nowMs = Date.now();
    const grants = new MemoryAvatarExecutionGrantStore("test-session-secret-that-is-long-enough");
    const authorizationId = grants.issue(
      "session-test",
      "The meeting moved to Tuesday afternoon",
      nowMs,
    );

    expect(grants.acceptEvent(authorizationId, "session-test", "started", nowMs + 5 * 60_000))
      .toBe(false);
    grants.dispose();
  });

  it.each([
    ["Please call an ambulance", "high_stakes_content"],
    ["My name is Alexandra Smith", "name_or_number_heavy"],
  ])("rejects %s before the provider request", async (text, reasonCode) => {
    const { app, events } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/avatar/authorize",
      headers: { cookie: session.cookie },
      payload: { text, locale: "en-US", source: "speech", staffConfirmed: true },
    });

    expect(response.statusCode).toBe(200);
    expect(AvatarAuthorizationResponseSchema.parse(response.json())).toEqual({
      allowed: false,
      reasonCode,
    });
    expect(events.events).toContainEqual(expect.objectContaining({
      type: "fallback",
      flow: "live",
      fallbackReason: reasonCode,
    }));
    expect(events.events.some((event) => event.type === "avatar_authorized")).toBe(false);
    expect(JSON.stringify(events.events)).not.toContain(text);
  });

  it("rejects a request without explicit staff confirmation", async () => {
    const { app } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/avatar/authorize",
      headers: { cookie: session.cookie },
      payload: {
        text: "Please wait in the lobby",
        locale: "en-US",
        source: "type",
        staffConfirmed: false,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_avatar_authorization" });
  });

  it("rejects execution telemetry that was not authorized for the session", async () => {
    const { app } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/avatar/events",
      headers: { cookie: session.cookie },
      payload: {
        authorizationId: "untrusted-authorization-id",
        result: "started",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "avatar_event_not_authorized" });
  });
});

async function authorizeAvatar(
  app: Awaited<ReturnType<typeof makeTestApp>>["app"],
  cookie: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/avatar/authorize",
    headers: { cookie },
    payload: {
      text: "The meeting moved to Tuesday afternoon",
      locale: "en-US",
      source: "type",
      staffConfirmed: true,
    },
  });
  expect(response.statusCode).toBe(200);
  const authorization = AvatarAuthorizationResponseSchema.parse(response.json());
  if (!authorization.allowed) throw new Error("expected avatar authorization");
  return authorization;
}

function recordAvatarEvent(
  app: Awaited<ReturnType<typeof makeTestApp>>["app"],
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
