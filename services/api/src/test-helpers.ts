import {
  CURRENT_CONSENT_VERSION,
  CatalogSchema,
  RECEPTION_INTENTS,
  REQUIRED_RIGHTS_USES,
  type Catalog,
} from "@signbridge/contracts";
import type { AppDependencies } from "./app.js";
import { buildApp } from "./app.js";
import { testConfig, type AppConfig } from "./config.js";
import { InMemoryCatalogRepository } from "./adapters/catalog.js";
import type { AssetSigner } from "./adapters/assets.js";
import type { IntentClassifier } from "./adapters/classifier.js";
import type { RevocationRepository } from "./adapters/revocations.js";
import type { SpeechProvider } from "./adapters/speech.js";
import {
  MemoryEventRepository,
  MemoryPendingDecisionRepository,
  MemoryPlaybackGrantRepository,
} from "./repositories.js";
import { TranscriptionService } from "./transcription-service.js";
import { LiveConcurrencyGuard } from "./live-concurrency.js";

export const NOW = "2026-08-01T12:00:00.000Z";

export function draftCatalog(): Catalog {
  return CatalogSchema.parse({
    schemaVersion: 1,
    catalogVersion: "2026-08-01-draft.1",
    immutable: true,
    status: "draft",
    languagePack: "ase-US",
    createdAt: NOW,
    publishedAt: null,
    supersedes: null,
    playbackEnabled: false,
    intents: RECEPTION_INTENTS.map((intent) => ({
      ...intent,
      recordingStatus: "not_recorded",
      reviewStatus: "not_reviewed",
      assetId: null,
      playbackEnabled: false,
    })),
    assets: [],
  });
}

export function publishedCatalog(): Catalog {
  const catalogVersion = "2026-08-01-published.1";
  const assets = RECEPTION_INTENTS.map((intent, index) => {
    const hash = (index + 1).toString(16).padStart(64, "0");
    return {
      id: `asset-${intent.id}`,
      intentId: intent.id,
      assetVersion: "1.0.0",
      languagePack: "ase-US",
      region: "US",
      dialect: "ASL",
      sha256: hash,
      mediaType: "video/mp4",
      durationMs: 2_000,
      width: 1_920,
      height: 1_080,
      frameRate: 30,
      videoCodec: "h264",
      muted: true,
      wholeUtterance: true,
      mirrored: false,
      objectFit: "contain",
      naturalPlaybackRate: 1,
      slowPlaybackApproved: false,
      signerRef: `signer/${index}`,
      approval: {
        status: "approved",
        reviewerRef: `reviewer/${index}`,
        reviewedSha256: hash,
        catalogVersion,
        reviewedAt: NOW,
      },
      rights: {
        status: "cleared",
        rightsRef: `rights/${index}`,
        coveredUses: [...REQUIRED_RIGHTS_USES],
      },
      storage: {
        kind: "gcs",
        bucket: "test-private-bucket",
        object: `catalog/${catalogVersion}/${intent.id}.mp4`,
        generation: "1",
        sizeBytes: 1_024,
        crc32c: "AAAAAA==",
        etag: `etag-${index}`,
        metadataSha256: hash,
      },
      playable: true,
    } as const;
  });
  return CatalogSchema.parse({
    schemaVersion: 1,
    catalogVersion,
    immutable: true,
    status: "published",
    languagePack: "ase-US",
    createdAt: NOW,
    publishedAt: NOW,
    supersedes: null,
    playbackEnabled: true,
    intents: RECEPTION_INTENTS.map((intent) => ({
      ...intent,
      recordingStatus: "recorded",
      reviewStatus: "approved",
      assetId: `asset-${intent.id}`,
      playbackEnabled: true,
    })),
    assets,
  });
}

export const fakeSpeech: SpeechProvider = {
  providerName: "google-cloud-speech",
  model: "chirp_3",
  async transcribeUpload() {
    return [];
  },
  startLive() {
    throw new Error("not used by this test");
  },
};

export function supportedClassifier(): IntentClassifier {
  return {
    providerName: "gemini",
    async classify() {
      return {
        state: "supported",
        intentId: "greeting",
        reasonCode: "matched_supported_intent",
        model: "gemini-3.6-flash",
        invocationId: "invocation-test",
        requiresHumanConfirmation: true,
      };
    },
    async createOperationsReport() {
      throw new Error("not used by this test");
    },
  };
}

export async function makeTestApp(options: {
  config?: Partial<AppConfig>;
  catalog?: Catalog;
  classifier?: IntentClassifier;
  assetSigner?: AssetSigner;
  revocations?: RevocationRepository;
  speech?: SpeechProvider;
} = {}): Promise<{
  app: Awaited<ReturnType<typeof buildApp>>;
  dependencies: AppDependencies;
  events: MemoryEventRepository;
}> {
  const config = testConfig(options.config);
  const speech = options.speech ?? fakeSpeech;
  const classifier = options.classifier ?? supportedClassifier();
  const pendingDecisions = new MemoryPendingDecisionRepository();
  const playbackGrants = new MemoryPlaybackGrantRepository();
  const events = new MemoryEventRepository();
  const catalog = new InMemoryCatalogRepository(options.catalog ?? draftCatalog());
  const assetSigner =
    options.assetSigner ??
    ({
      async sign() {
        throw new Error("asset signing should not be reached");
      },
    } satisfies AssetSigner);
  const revocations =
    options.revocations ??
    ({
      async current() {
        return { schemaVersion: 1, immutableEntries: true, updatedAt: NOW, entries: [] };
      },
    } satisfies RevocationRepository);
  const transcription = new TranscriptionService(speech, classifier, pendingDecisions, events);
  const dependencies: AppDependencies = {
    config,
    speech,
    classifier,
    catalog,
    assetSigner,
    pendingDecisions,
    playbackGrants,
    revocations,
    events,
    transcription,
    liveConcurrency: new LiveConcurrencyGuard(2),
  };
  return { app: await buildApp(dependencies), dependencies, events };
}

export async function authenticate(
  app: Awaited<ReturnType<typeof buildApp>>,
  accessCode = "site-code-test",
): Promise<{ cookie: string; sessionId: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/session/exchange",
    headers: { origin: "http://127.0.0.1:4173" },
    payload: {
      accessCode,
      consentVersion: CURRENT_CONSENT_VERSION,
    },
  });
  const setCookie = response.headers["set-cookie"];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = cookieHeader?.split(";", 1)[0];
  if (!cookie) throw new Error(`Authentication failed: ${response.statusCode}`);
  return { cookie, sessionId: response.json<{ sessionId: string }>().sessionId };
}
