import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";
import type { AuthSession, SessionRole } from "./domain.js";

export const SESSION_COOKIE = "signbridge_session";

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHmac("sha256", "signbridge-code-comparison").update(left).digest();
  const rightHash = createHmac("sha256", "signbridge-code-comparison").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function resolveRole(accessCode: string, config: AppConfig): SessionRole | null {
  if (constantTimeEqual(accessCode, config.adminAccessCode)) return "admin";
  if (constantTimeEqual(accessCode, config.pilotSiteCode)) return "site";
  return null;
}

export function createSession(
  role: SessionRole,
  consentVersion: string,
  config: AppConfig,
  now = new Date(),
): AuthSession {
  return {
    sessionId: randomUUID(),
    siteId: config.pilotSiteId,
    role,
    consentVersion,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + config.sessionTtlSeconds * 1_000).toISOString(),
  };
}

export function encodeSession(session: AuthSession, secret: string): string {
  const payload = encode(session);
  return `${payload}.${sign(payload, secret)}`;
}

export function decodeSession(token: string | undefined, secret: string, now = new Date()): AuthSession | null {
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = sign(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthSession;
    if (
      typeof value.sessionId !== "string" ||
      typeof value.siteId !== "string" ||
      (value.role !== "site" && value.role !== "admin") ||
      typeof value.consentVersion !== "string" ||
      typeof value.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      Date.parse(value.expiresAt) <= now.getTime()
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function setSessionCookie(reply: FastifyReply, session: AuthSession, config: AppConfig): void {
  reply.setCookie(SESSION_COOKIE, encodeSession(session, config.sessionSecret), {
    httpOnly: true,
    sameSite: "strict",
    secure: config.nodeEnv === "production",
    path: "/",
    maxAge: config.sessionTtlSeconds,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.nodeEnv === "production",
    path: "/",
  });
}

export function readSession(request: FastifyRequest, config: AppConfig): AuthSession | null {
  return decodeSession(request.cookies[SESSION_COOKIE], config.sessionSecret);
}

export async function requireSite(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> {
  if (!request.authSession) {
    return reply.code(401).send({ error: "authentication_required" });
  }
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> {
  if (!request.authSession) {
    return reply.code(401).send({ error: "authentication_required" });
  }
  if (request.authSession.role !== "admin") {
    return reply.code(403).send({ error: "admin_required" });
  }
}
