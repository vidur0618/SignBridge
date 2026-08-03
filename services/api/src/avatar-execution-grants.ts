import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const AUTHORIZATION_TTL_MS = 5 * 60_000;
const REQUEST_ID_PATTERN = /^[a-f0-9]{32}$/;
const EXPIRY_PATTERN = /^[0-9a-z]{1,8}$/;
const DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type AvatarExecutionResult = "started" | "completed" | "failed";

export interface AvatarAuthorizationClaims {
  requestId: string;
  expiresAtMs: number;
  textHash: string;
}

interface AvatarExecutionGrant extends AvatarAuthorizationClaims {
  authorizationId: string;
  sessionId: string;
  state: "authorized" | "started";
}

interface CreateAuthorizationOptions {
  nowMs?: number;
  requestId?: string;
}

/**
 * Produces an opaque, transcript-free authorization token. The text fingerprint
 * is an HMAC salted by the session and request ID, so persistent operational
 * telemetry cannot be compared against a dictionary of likely captions.
 *
 * This binds the server grant to the normalized text it returned. It cannot
 * force a browser SDK to submit that text to its provider; the browser-provider
 * hop remains a cooperative control and must not be represented as enforcement.
 */
export function createAvatarAuthorizationId(
  sessionId: string,
  normalizedText: string,
  secret: string,
  options: CreateAuthorizationOptions = {},
): string {
  const nowMs = options.nowMs ?? Date.now();
  const requestId = options.requestId ?? randomUUID().replaceAll("-", "");
  if (!REQUEST_ID_PATTERN.test(requestId)) throw new Error("Invalid avatar request ID");
  const expiresAt = Math.floor((nowMs + AUTHORIZATION_TTL_MS) / 1_000).toString(36);
  const textHash = avatarTextHash(sessionId, requestId, normalizedText, secret);
  const signature = avatarAuthorizationSignature(sessionId, requestId, expiresAt, textHash, secret);
  return `${requestId}.${expiresAt}.${textHash}.${signature}`;
}

export function verifyAvatarAuthorizationId(
  authorizationId: string,
  sessionId: string,
  secret: string,
  options: { normalizedText?: string; nowMs?: number } = {},
): AvatarAuthorizationClaims | null {
  const [requestId, expiresAt, textHash, signature, ...extra] = authorizationId.split(".");
  if (
    !requestId ||
    !expiresAt ||
    !textHash ||
    !signature ||
    extra.length > 0 ||
    !REQUEST_ID_PATTERN.test(requestId) ||
    !EXPIRY_PATTERN.test(expiresAt) ||
    !DIGEST_PATTERN.test(textHash) ||
    !DIGEST_PATTERN.test(signature)
  ) {
    return null;
  }

  const expirySeconds = Number.parseInt(expiresAt, 36);
  const expiresAtMs = expirySeconds * 1_000;
  if (!Number.isSafeInteger(expirySeconds) || expiresAtMs <= (options.nowMs ?? Date.now())) return null;

  const expectedSignature = avatarAuthorizationSignature(
    sessionId,
    requestId,
    expiresAt,
    textHash,
    secret,
  );
  if (!safeDigestEqual(signature, expectedSignature)) return null;

  if (options.normalizedText != null) {
    const expectedTextHash = avatarTextHash(
      sessionId,
      requestId,
      options.normalizedText,
      secret,
    );
    if (!safeDigestEqual(textHash, expectedTextHash)) return null;
  }

  return { requestId, expiresAtMs, textHash };
}

/**
 * Short-lived execution lifecycle for the current one-instance deployment.
 * Grants deliberately stay in process: raising max instances requires a shared,
 * atomic store before this can be relied upon across requests.
 */
export class MemoryAvatarExecutionGrantStore {
  readonly #grants = new Map<string, AvatarExecutionGrant>();
  readonly #secret: string;
  #expiryTimer: NodeJS.Timeout | null = null;

  constructor(secret: string) {
    this.#secret = secret;
  }

  issue(sessionId: string, normalizedText: string, nowMs = Date.now()): string {
    this.#cleanupExpired(nowMs);
    const authorizationId = createAvatarAuthorizationId(sessionId, normalizedText, this.#secret, {
      nowMs,
    });
    const claims = verifyAvatarAuthorizationId(authorizationId, sessionId, this.#secret, {
      normalizedText,
      nowMs,
    });
    if (!claims) throw new Error("Failed to create avatar authorization");
    this.#grants.set(authorizationId, {
      ...claims,
      authorizationId,
      sessionId,
      state: "authorized",
    });
    this.#scheduleExpiryCleanup(nowMs);
    return authorizationId;
  }

  acceptEvent(
    authorizationId: string,
    sessionId: string,
    result: AvatarExecutionResult,
    nowMs = Date.now(),
  ): boolean {
    this.#cleanupExpired(nowMs);
    const claims = verifyAvatarAuthorizationId(authorizationId, sessionId, this.#secret, { nowMs });
    const grant = this.#grants.get(authorizationId);
    if (
      !claims ||
      !grant ||
      grant.sessionId !== sessionId ||
      grant.requestId !== claims.requestId ||
      grant.expiresAtMs !== claims.expiresAtMs ||
      grant.textHash !== claims.textHash
    ) {
      return false;
    }

    if (grant.state === "authorized") {
      if (result === "completed") return false;
      if (result === "started") {
        this.#grants.set(authorizationId, { ...grant, state: "started" });
      } else {
        // A provider/SDK failure may occur before the first visible motion.
        this.#grants.delete(authorizationId);
      }
      this.#scheduleExpiryCleanup(nowMs);
      return true;
    }

    if (result === "started") return false;
    this.#grants.delete(authorizationId);
    this.#scheduleExpiryCleanup(nowMs);
    return true;
  }

  dispose(): void {
    if (this.#expiryTimer) clearTimeout(this.#expiryTimer);
    this.#expiryTimer = null;
    this.#grants.clear();
  }

  #cleanupExpired(nowMs: number): void {
    for (const [authorizationId, grant] of this.#grants) {
      if (grant.expiresAtMs <= nowMs) this.#grants.delete(authorizationId);
    }
  }

  #scheduleExpiryCleanup(nowMs: number): void {
    if (this.#expiryTimer) clearTimeout(this.#expiryTimer);
    this.#expiryTimer = null;
    let earliestExpiry = Number.POSITIVE_INFINITY;
    for (const grant of this.#grants.values()) {
      earliestExpiry = Math.min(earliestExpiry, grant.expiresAtMs);
    }
    if (!Number.isFinite(earliestExpiry)) return;
    this.#expiryTimer = setTimeout(() => {
      const cleanupAt = Date.now();
      this.#cleanupExpired(cleanupAt);
      this.#scheduleExpiryCleanup(cleanupAt);
    }, Math.max(0, earliestExpiry - nowMs));
    this.#expiryTimer.unref();
  }
}

function avatarTextHash(
  sessionId: string,
  requestId: string,
  normalizedText: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update("signbridge-avatar-text-v1\0")
    .update(sessionId)
    .update("\0")
    .update(requestId)
    .update("\0")
    .update(normalizedText)
    .digest("base64url");
}

function avatarAuthorizationSignature(
  sessionId: string,
  requestId: string,
  expiresAt: string,
  textHash: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update("signbridge-avatar-authorization-v1\0")
    .update(sessionId)
    .update("\0")
    .update(requestId)
    .update("\0")
    .update(expiresAt)
    .update("\0")
    .update(textHash)
    .digest("base64url");
}

function safeDigestEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
