import { afterEach, describe, expect, it } from "vitest";
import {
  AvatarAuthorizationResponseSchema,
  AvatarExecutionEventResponseSchema,
} from "@signbridge/contracts";

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

  it("authorizes confirmed low-risk text and records transcript-free execution evidence", async () => {
    const { app, events } = await makeTestApp({ config: { handtalkToken: "test-token" } });
    apps.push(app);
    const session = await authenticate(app);
    const text = "The meeting moved to Tuesday afternoon";

    const response = await app.inject({
      method: "POST",
      url: "/api/avatar/authorize",
      headers: { cookie: session.cookie },
      payload: { text, locale: "en-US", source: "type", staffConfirmed: true },
    });

    expect(response.statusCode).toBe(200);
    const authorization = AvatarAuthorizationResponseSchema.parse(response.json());
    expect(authorization).toMatchObject({ allowed: true, provider: "handtalk", text });
    if (!authorization.allowed) throw new Error("expected avatar authorization");

    const eventResponse = await app.inject({
      method: "POST",
      url: "/api/avatar/events",
      headers: { cookie: session.cookie },
      payload: {
        authorizationId: authorization.authorizationId,
        result: "completed",
        latencyMs: 420,
      },
    });

    expect(eventResponse.statusCode).toBe(202);
    expect(AvatarExecutionEventResponseSchema.parse(eventResponse.json())).toEqual({ accepted: true });
    expect(events.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "avatar_authorized",
        flow: "typed",
        avatarProvider: "handtalk",
        avatarAuthorizationId: authorization.authorizationId,
      }),
      expect.objectContaining({
        type: "avatar_execution",
        avatarResult: "completed",
        avatarLatencyMs: 420,
        avatarAuthorizationId: authorization.authorizationId,
      }),
    ]));
    expect(JSON.stringify(events.events)).not.toContain(text);
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
