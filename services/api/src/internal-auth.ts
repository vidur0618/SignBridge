import { OAuth2Client } from "google-auth-library";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";

export async function authenticateInternalRequest(
  request: FastifyRequest,
  config: AppConfig,
): Promise<boolean> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const token = authorization.slice("Bearer ".length);
  if (config.opsJobSecret && token === config.opsJobSecret) return true;
  if (!config.internalOidcAudience || !config.internalOidcServiceAccount) return false;
  try {
    const ticket = await new OAuth2Client().verifyIdToken({
      idToken: token,
      audience: config.internalOidcAudience,
    });
    const payload = ticket.getPayload();
    return (
      payload?.email_verified === true &&
      payload.email?.toLowerCase() === config.internalOidcServiceAccount.toLowerCase()
    );
  } catch {
    return false;
  }
}
