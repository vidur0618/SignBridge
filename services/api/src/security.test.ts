import { afterEach, describe, expect, it } from "vitest";
import { authenticate, makeTestApp } from "./test-helpers.js";

const apps: Array<Awaited<ReturnType<typeof makeTestApp>>["app"]> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("session and same-origin security", () => {
  it("sets an HttpOnly, SameSite strict session and protects the catalog", async () => {
    const { app } = await makeTestApp();
    apps.push(app);
    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toMatchObject({
      status: "ok",
      mode: "local-safe",
      service: null,
      revision: null,
      deploymentSha: null,
      configuredModels: { speech: null, classifier: null },
    });
    expect((await app.inject({ method: "GET", url: "/api/catalog" })).statusCode).toBe(401);
    const login = await app.inject({
      method: "POST",
      url: "/api/session/exchange",
      headers: { origin: "http://127.0.0.1:4173" },
      payload: {
        accessCode: "site-code-test",
        consentVersion: "2026-08-01.1",
      },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["set-cookie"]).toContain("HttpOnly");
    expect(login.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(login.headers["permissions-policy"]).toContain("microphone=(self)");
    expect(login.headers["permissions-policy"]).toContain("payment=()");
    expect(login.json()).not.toHaveProperty("role");
  });

  it("rejects a mismatched browser origin and separates admin capability", async () => {
    const { app } = await makeTestApp();
    apps.push(app);
    const crossOrigin = await app.inject({
      method: "POST",
      url: "/api/session/exchange",
      headers: { origin: "https://attacker.example" },
      payload: {},
    });
    expect(crossOrigin.statusCode).toBe(403);

    const site = await authenticate(app);
    expect(
      (await app.inject({ method: "GET", url: "/api/admin/metrics", headers: { cookie: site.cookie } }))
        .statusCode,
    ).toBe(403);
    const admin = await authenticate(app, "admin-code-test-value");
    expect(
      (await app.inject({ method: "GET", url: "/api/admin/metrics", headers: { cookie: admin.cookie } }))
        .statusCode,
    ).toBe(200);
  });
});
