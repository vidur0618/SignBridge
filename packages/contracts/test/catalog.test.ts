import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  AssetRevocationRegistrySchema,
  CatalogSchema,
  RECEPTION_INTENT_IDS,
  RECEPTION_INTENTS,
  SignAssetSchema,
  createRenderSegment,
  createSignPlan,
  isAssetRevoked,
  type Catalog,
  type DetectedIntent,
  type SignAsset,
  type StableUtterance,
} from "../src/index.js";

const now = "2026-08-01T12:00:00.000Z";
const digest = "a".repeat(64);

function approvedAsset(intentId: (typeof RECEPTION_INTENT_IDS)[number], index: number): SignAsset {
  return SignAssetSchema.parse({
    id: `asset-${index}`,
    intentId,
    assetVersion: "v1",
    languagePack: "ase-US",
    region: "US",
    dialect: "ASL",
    sha256: digest,
    mediaType: "video/mp4",
    videoCodec: "h264",
    durationMs: 2_000,
    width: 1920,
    height: 1080,
    frameRate: 30,
    muted: true,
    wholeUtterance: true,
    mirrored: false,
    objectFit: "contain",
    naturalPlaybackRate: 1,
    slowPlaybackApproved: false,
    signerRef: "private:signers/signer-001",
    approval: {
      status: "approved",
      reviewerRef: "private:reviewers/reviewer-001",
      reviewedSha256: digest,
      catalogVersion: "pilot-v1",
      reviewedAt: now,
    },
    rights: {
      status: "cleared",
      rightsRef: "private:rights/release-001",
      coveredUses: ["commercial_pilot", "hosting", "contest_demo", "judge_access", "sponsor_publicity"],
    },
    storage: {
      kind: "gcs",
      bucket: "signbridge-private-assets",
      object: `ase-US/pilot-v1/asset-${index}.mp4`,
      generation: "1722530000000000",
      sizeBytes: 100_000,
      crc32c: "AAAAAA==",
      etag: `etag-${index}`,
      metadataSha256: digest,
    },
    playable: true,
  });
}

function publishedCatalog(): Catalog {
  const assets = RECEPTION_INTENT_IDS.map(approvedAsset);
  return CatalogSchema.parse({
    schemaVersion: 1,
    catalogVersion: "pilot-v1",
    immutable: true,
    status: "published",
    languagePack: "ase-US",
    createdAt: now,
    publishedAt: now,
    supersedes: null,
    playbackEnabled: true,
    intents: RECEPTION_INTENTS.map((intent, index) => ({
      ...intent,
      recordingStatus: "recorded",
      reviewStatus: "approved",
      assetId: assets[index]?.id,
      playbackEnabled: true,
    })),
    assets,
  });
}

describe("server-owned catalog", () => {
  it("defines exactly ten unique bounded reception intents", () => {
    expect(RECEPTION_INTENT_IDS).toHaveLength(10);
    expect(new Set(RECEPTION_INTENT_IDS).size).toBe(10);
    expect(RECEPTION_INTENTS.map((intent) => intent.id)).toEqual(RECEPTION_INTENT_IDS);
  });

  it("parses the checked-in catalog as an honest non-playable draft", () => {
    const path = fileURLToPath(new URL("../../../content/catalog/catalog.v1.draft.json", import.meta.url));
    const draft = CatalogSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    expect(draft.status).toBe("draft");
    expect(draft.playbackEnabled).toBe(false);
    expect(draft.assets).toEqual([]);
    expect(draft.intents.every((intent) => intent.assetId === null && !intent.playbackEnabled)).toBe(true);
  });

  it("rejects a playable asset with fabricated draft approval", () => {
    const valid = approvedAsset("greeting", 0);
    expect(
      SignAssetSchema.safeParse({
        ...valid,
        approval: {
          status: "draft",
          reviewerRef: null,
          reviewedSha256: null,
          catalogVersion: null,
          reviewedAt: null,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects review or GCS metadata that does not bind the exact hash", () => {
    const valid = approvedAsset("greeting", 0);
    expect(
      SignAssetSchema.safeParse({
        ...valid,
        approval: { ...valid.approval, reviewedSha256: "b".repeat(64) },
      }).success,
    ).toBe(false);
    expect(
      SignAssetSchema.safeParse({
        ...valid,
        storage: { ...valid.storage, metadataSha256: "b".repeat(64) },
      }).success,
    ).toBe(false);
  });

  it("rejects withdrawn playback immediately", () => {
    const valid = approvedAsset("greeting", 0);
    expect(
      SignAssetSchema.safeParse({
        ...valid,
        approval: {
          ...valid.approval,
          status: "withdrawn",
          withdrawnAt: now,
          withdrawalRef: "private:withdrawals/withdrawal-001",
        },
      }).success,
    ).toBe(false);
  });

  it("requires exact launch media metadata and an independent reviewer", () => {
    const valid = approvedAsset("greeting", 0);
    expect(SignAssetSchema.safeParse({ ...valid, width: 1280, height: 720 }).success).toBe(false);
    expect(SignAssetSchema.safeParse({ ...valid, videoCodec: "vp9" }).success).toBe(false);
    expect(
      SignAssetSchema.safeParse({
        ...valid,
        signerRef: valid.approval.status === "approved" ? valid.approval.reviewerRef : "unreachable",
      }).success,
    ).toBe(false);
  });

  it("requires all ten exact assets before publication", () => {
    const catalog = publishedCatalog();
    expect(catalog.assets).toHaveLength(10);
    expect(
      CatalogSchema.safeParse({
        ...catalog,
        intents: catalog.intents.map((intent, index) =>
          index === 0 ? { ...intent, playbackEnabled: false } : intent,
        ),
      }).success,
    ).toBe(false);
  });

  it("keeps catalog lifecycle and recording claims internally consistent", () => {
    const catalog = publishedCatalog();
    expect(
      CatalogSchema.safeParse({
        ...catalog,
        intents: catalog.intents.map((intent, index) =>
          index === 0 ? { ...intent, recordingStatus: "not_recorded" } : intent,
        ),
      }).success,
    ).toBe(false);

    expect(
      CatalogSchema.safeParse({
        ...catalog,
        status: "draft",
        playbackEnabled: false,
        intents: catalog.intents.map((intent) => ({ ...intent, playbackEnabled: false })),
      }).success,
    ).toBe(false);
  });
});

describe("sign plan creation", () => {
  const utterance: StableUtterance = {
    id: "utterance-1",
    sessionId: "session-1",
    segmentIds: ["segment-1"],
    transcript: "Welcome",
    isFinal: true,
    finalizationReason: "asr_is_final",
    finalizedAt: now,
  };
  const candidate: DetectedIntent = {
    id: "candidate-1",
    utteranceId: "utterance-1",
    status: "supported",
    intentId: "greeting",
    reasonCode: "matched_supported_intent",
    execution: {
      route: "gemini",
      model: "gemini-3.6-flash",
      invocationId: "invocation-1",
    },
    requiresHumanConfirmation: true,
    classifiedAt: now,
  };

  it("creates a one-asset, caption-preserving plan that still requires staff confirmation", () => {
    expect(
      createSignPlan({ id: "plan-1", createdAt: now, utterance, detectedIntent: candidate, catalog: publishedCatalog() }),
    ).toMatchObject({
      utteranceId: utterance.id,
      intentId: "greeting",
      caption: utterance.transcript,
      wholeUtterance: true,
      staffConfirmation: "required",
      fallbackRule: "captions_only",
    });
  });

  it("creates only a caption-bound, policy-approved render segment", () => {
    const catalog = publishedCatalog();
    const signPlan = createSignPlan({
      id: "plan-1",
      createdAt: now,
      utterance,
      detectedIntent: candidate,
      catalog,
    });
    const commonInput = {
      id: "render-1",
      signPlan,
      catalog,
      caption: signPlan.caption,
      videoUrl: "https://assets.example.test/greeting.mp4",
      urlExpiresAt: "2026-08-01T12:05:00.000Z",
    } as const;

    expect(createRenderSegment({ ...commonInput, playbackRate: 1 })).toMatchObject({
      assetId: signPlan.assetId,
      caption: signPlan.caption,
      playbackRate: 1,
      objectFit: "contain",
      mirrored: false,
      captionsVisible: true,
    });
    expect(() =>
      createRenderSegment({ ...commonInput, caption: "A different caption", playbackRate: 1 }),
    ).toThrow("Render caption must equal");
    expect(() => createRenderSegment({ ...commonInput, playbackRate: 0.75 })).toThrow(
      "Slow playback has not been approved",
    );

    const slowCatalog = CatalogSchema.parse({
      ...catalog,
      assets: catalog.assets.map((asset) =>
        asset.id === signPlan.assetId ? { ...asset, slowPlaybackApproved: true } : asset,
      ),
    });
    expect(
      createRenderSegment({ ...commonInput, catalog: slowCatalog, playbackRate: 0.75 }),
    ).toMatchObject({ playbackRate: 0.75 });
  });

  it("blocks a revoked exact asset before plan or render creation", () => {
    const catalog = publishedCatalog();
    const asset = catalog.assets.find((item) => item.intentId === "greeting");
    expect(asset).toBeDefined();
    if (!asset) throw new Error("test fixture is missing greeting asset");
    const revocations = AssetRevocationRegistrySchema.parse({
      schemaVersion: 1,
      immutableEntries: true,
      updatedAt: "2026-08-01T12:01:00.000Z",
      entries: [
        {
          assetId: asset.id,
          assetSha256: asset.sha256,
          catalogVersion: catalog.catalogVersion,
          withdrawnAt: "2026-08-01T12:01:00.000Z",
          withdrawalRef: "private:withdrawals/withdrawal-001",
        },
      ],
    });
    expect(
      isAssetRevoked(revocations, {
        assetId: asset.id,
        assetSha256: asset.sha256,
        catalogVersion: catalog.catalogVersion,
      }),
    ).toBe(true);
    expect(() =>
      createSignPlan({
        id: "plan-1",
        createdAt: now,
        utterance,
        detectedIntent: candidate,
        catalog,
        revocations,
      }),
    ).toThrow("withdrawn");
  });

  it("refuses to create a sign plan from the honest draft catalog", () => {
    const path = fileURLToPath(new URL("../../../content/catalog/catalog.v1.draft.json", import.meta.url));
    const draft = CatalogSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    expect(() =>
      createSignPlan({ id: "plan-1", createdAt: now, utterance, detectedIntent: candidate, catalog: draft }),
    ).toThrow("Only a published, playback-enabled catalog");
  });
});
