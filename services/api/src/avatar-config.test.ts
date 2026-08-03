import { afterEach, describe, expect, it } from "vitest";
import { AvatarRuntimeConfigResponseSchema } from "@signbridge/contracts";
import { authenticate, makeTestApp } from "./test-helpers.js";

const apps: Array<Awaited<ReturnType<typeof makeTestApp>>["app"]> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("Hand Talk avatar runtime configuration", () => {
  it("requires a normal authenticated session", async () => {
    const { app } = await makeTestApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/avatar/config" });

    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("reports a token-free disabled configuration when Hand Talk is not configured", async () => {
    const { app } = await makeTestApp();
    apps.push(app);
    const session = await authenticate(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/avatar/config",
      headers: { cookie: session.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const payload = AvatarRuntimeConfigResponseSchema.parse(response.json());
    expect(payload).toEqual({
      provider: "handtalk",
      enabled: false,
      avatar: "HUGO",
      language: "enUS",
      signLanguage: "en-ase",
      maxCharacters: 1_000,
      status: "experimental",
    });
    expect(payload).not.toHaveProperty("token");
    expect(payload).not.toHaveProperty("sdkUrl");
  });

  it("returns the SDK token only from the authenticated config route when configured", async () => {
    const secretToken = "handtalk-test-token-never-log";
    const { app } = await makeTestApp({
      config: {
        handtalkToken: secretToken,
        handtalkAvatar: "MAYA",
      },
    });
    apps.push(app);
    const session = await authenticate(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/avatar/config",
      headers: { cookie: session.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(AvatarRuntimeConfigResponseSchema.parse(response.json())).toEqual({
      provider: "handtalk",
      enabled: true,
      token: secretToken,
      sdkUrl: "https://api-cdn.handtalk.me/sdk/1.0.0/ht-api-sdk.min.js",
      avatar: "MAYA",
      language: "enUS",
      signLanguage: "en-ase",
      maxCharacters: 1_000,
      status: "experimental",
    });

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.body).not.toContain(secretToken);
    expect(health.body).not.toContain("HANDTALK_TOKEN");
  });
});
