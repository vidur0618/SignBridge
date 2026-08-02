import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { readSession } from "./security.js";
import {
  GeminiClassifier,
  LocalUnavailableClassifier,
  type IntentClassifier,
} from "./adapters/classifier.js";
import {
  GoogleCloudAssetSigner,
  LocalUnavailableAssetSigner,
  type AssetSigner,
} from "./adapters/assets.js";
import {
  GoogleSpeechProvider,
  LocalUnavailableSpeechProvider,
  type SpeechProvider,
} from "./adapters/speech.js";
import { loadCatalog, type CatalogRepository } from "./adapters/catalog.js";
import {
  FileRevocationRepository,
  type RevocationRepository,
} from "./adapters/revocations.js";
import {
  FirestoreRepositories,
  MemoryEventRepository,
  MemoryPendingDecisionRepository,
  MemoryPlaybackGrantRepository,
  type EventRepository,
  type PendingDecisionRepository,
  type PlaybackGrantRepository,
} from "./repositories.js";
import { TranscriptionService } from "./transcription-service.js";
import { LiveConcurrencyGuard } from "./live-concurrency.js";
import { registerRoutes } from "./routes.js";
import { registerLiveTranscription } from "./websocket.js";

export interface AppDependencies {
  config: AppConfig;
  speech: SpeechProvider;
  classifier: IntentClassifier;
  catalog: CatalogRepository;
  assetSigner: AssetSigner;
  pendingDecisions: PendingDecisionRepository;
  events: EventRepository;
  playbackGrants: PlaybackGrantRepository;
  revocations: RevocationRepository;
  transcription: TranscriptionService;
  liveConcurrency: LiveConcurrencyGuard;
}

export async function createDependencies(config: AppConfig): Promise<AppDependencies> {
  const catalog = await loadCatalog(config.signCatalogPath ?? (await discoverCatalogPath()));
  const pendingDecisions = new MemoryPendingDecisionRepository();
  const playbackGrants = new MemoryPlaybackGrantRepository();
  const cloudRepositories = config.useGoogleCloud ? new FirestoreRepositories(config) : null;
  const events: EventRepository = cloudRepositories ?? new MemoryEventRepository();
  const revocations: RevocationRepository =
    cloudRepositories ?? new FileRevocationRepository(config.signRevocationPath);
  const speech = config.useGoogleCloud
    ? new GoogleSpeechProvider(config)
    : new LocalUnavailableSpeechProvider();
  const classifier = config.useGoogleCloud
    ? new GeminiClassifier(config)
    : new LocalUnavailableClassifier();
  const assetSigner = config.useGoogleCloud
    ? new GoogleCloudAssetSigner(config)
    : new LocalUnavailableAssetSigner();
  const transcription = new TranscriptionService(
    speech,
    classifier,
    pendingDecisions,
    events,
  );
  return {
    config,
    speech,
    classifier,
    catalog,
    assetSigner,
    pendingDecisions,
    events,
    playbackGrants,
    revocations,
    transcription,
    liveConcurrency: new LiveConcurrencyGuard(config.maxLiveSessionsPerSite),
  };
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      dependencies.config.nodeEnv === "test"
        ? false
        : {
            level: dependencies.config.nodeEnv === "production" ? "info" : "warn",
            redact: {
              paths: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
              censor: "[REDACTED]",
            },
            serializers: {
              req: (request) => ({ method: request.method, url: request.url }),
            },
          },
    bodyLimit: 10 * 1024 * 1024 + 64 * 1024,
    trustProxy: dependencies.config.nodeEnv === "production",
    requestTimeout: 30_000,
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        mediaSrc: ["'self'", "https:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
  });
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.authSession?.sessionId ?? request.ip,
  });
  await app.register(multipart, {
    limits: { files: 1, fileSize: 10 * 1024 * 1024, fields: 4, parts: 5 },
    attachFieldsToBody: false,
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin?.replace(/\/$/, "");
    if (origin && origin !== dependencies.config.appOrigin) {
      return reply.code(403).send({ error: "cross_origin_request_rejected" });
    }
    if (request.headers["sec-fetch-site"] === "cross-site") {
      return reply.code(403).send({ error: "cross_site_request_rejected" });
    }
    const session = readSession(request, dependencies.config);
    if (session) request.authSession = session;
    else delete request.authSession;
  });
  app.addHook("onSend", (request, reply, payload, done) => {
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    reply.header(
      "Permissions-Policy",
      "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
    );
    done(null, payload);
  });
  app.setErrorHandler((error: unknown, request, reply) => {
    const candidateStatus =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    const statusCode = candidateStatus >= 400 && candidateStatus < 500 ? candidateStatus : 500;
    const errorName = error instanceof Error ? error.name : "UnknownError";
    if (statusCode >= 500) {
      request.log.error({ errorName, statusCode }, "request failed");
    }
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "internal_error" : "invalid_request",
    });
  });

  await registerRoutes(app, dependencies);
  await registerLiveTranscription(app, dependencies);
  await registerWebApp(app, dependencies.config.webDistDir);
  return app;
}

async function registerWebApp(app: FastifyInstance, webDistDir: string | undefined): Promise<void> {
  if (!webDistDir) return;
  try {
    if (!(await stat(webDistDir)).isDirectory()) return;
  } catch {
    return;
  }
  await app.register(fastifyStatic, { root: webDistDir, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api/")) {
      return reply.type("text/html; charset=utf-8").sendFile("index.html");
    }
    return reply.code(404).send({ error: "not_found" });
  });
}

async function discoverCatalogPath(): Promise<string> {
  const candidates = [
    resolve(process.cwd(), "content/catalog/catalog.v1.draft.json"),
    resolve(process.cwd(), "../../content/catalog/catalog.v1.draft.json"),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue to the next explicit repository location.
    }
  }
  throw new Error("No catalog found; set SIGN_CATALOG_PATH explicitly");
}
