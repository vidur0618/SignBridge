import { z } from "zod";

import {
  IdentifierSchema,
  IsoTimestampSchema,
  LanguagePackSchema,
  SafeReferenceSchema,
  Sha256Schema,
  VersionSchema,
} from "./common.js";
import {
  RECEPTION_INTENT_IDS,
  ReceptionIntentIdSchema,
  type ReceptionIntentId,
} from "./intents.js";

export const REQUIRED_RIGHTS_USES = [
  "commercial_pilot",
  "hosting",
  "contest_demo",
  "judge_access",
  "sponsor_publicity",
] as const;

export const RightsUseSchema = z.enum(REQUIRED_RIGHTS_USES);
export type RightsUse = z.infer<typeof RightsUseSchema>;

const DraftApprovalSchema = z
  .object({
    status: z.literal("draft"),
    reviewerRef: z.null(),
    reviewedSha256: z.null(),
    catalogVersion: z.null(),
    reviewedAt: z.null(),
  })
  .strict();

const ApprovedApprovalSchema = z
  .object({
    status: z.literal("approved"),
    reviewerRef: SafeReferenceSchema,
    reviewedSha256: Sha256Schema,
    catalogVersion: VersionSchema,
    reviewedAt: IsoTimestampSchema,
  })
  .strict();

const WithdrawnApprovalSchema = z
  .object({
    status: z.literal("withdrawn"),
    reviewerRef: SafeReferenceSchema,
    reviewedSha256: Sha256Schema,
    catalogVersion: VersionSchema,
    reviewedAt: IsoTimestampSchema,
    withdrawnAt: IsoTimestampSchema,
    withdrawalRef: SafeReferenceSchema,
  })
  .strict();

export const AssetApprovalSchema = z.discriminatedUnion("status", [
  DraftApprovalSchema,
  ApprovedApprovalSchema,
  WithdrawnApprovalSchema,
]);
export type AssetApproval = z.infer<typeof AssetApprovalSchema>;

const UnclearedRightsSchema = z
  .object({
    status: z.literal("uncleared"),
    rightsRef: z.null(),
    coveredUses: z.array(z.never()).max(0),
  })
  .strict();

const ClearedRightsSchema = z
  .object({
    status: z.literal("cleared"),
    rightsRef: SafeReferenceSchema,
    coveredUses: z.array(RightsUseSchema).length(REQUIRED_RIGHTS_USES.length),
  })
  .strict()
  .superRefine((rights, context) => {
    const uses = new Set(rights.coveredUses);
    if (uses.size !== REQUIRED_RIGHTS_USES.length) {
      context.addIssue({
        code: "custom",
        path: ["coveredUses"],
        message: "coveredUses must contain every required use exactly once",
      });
      return;
    }
    for (const requiredUse of REQUIRED_RIGHTS_USES) {
      if (!uses.has(requiredUse)) {
        context.addIssue({
          code: "custom",
          path: ["coveredUses"],
          message: `missing required rights use: ${requiredUse}`,
        });
      }
    }
  });

export const AssetRightsSchema = z.discriminatedUnion("status", [
  UnclearedRightsSchema,
  ClearedRightsSchema,
]);
export type AssetRights = z.infer<typeof AssetRightsSchema>;

export const LocalAssetStorageSchema = z
  .object({
    kind: z.literal("local"),
    path: z
      .string()
      .min(1)
      .max(240)
      .refine((value) => !value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value), "path must be repository-relative")
      .refine((value) => !value.split(/[\\/]/).includes(".."), "path cannot traverse outside the repository")
      .refine((value) => value.toLowerCase().endsWith(".mp4"), "local asset must be an MP4"),
    sizeBytes: z.number().int().positive(),
  })
  .strict();

export const GcsAssetStorageSchema = z
  .object({
    kind: z.literal("gcs"),
    bucket: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/, "invalid GCS bucket name"),
    object: z
      .string()
      .min(1)
      .max(1024)
      .refine((value) => !value.startsWith("/") && !value.split("/").includes(".."), "invalid GCS object name"),
    generation: z.string().regex(/^[1-9][0-9]*$/, "GCS generation must be explicit"),
    sizeBytes: z.number().int().positive(),
    crc32c: z.string().regex(/^[A-Za-z0-9+/]{6}==$/, "crc32c must be four bytes encoded as base64"),
    etag: z.string().min(1).max(256),
    metadataSha256: Sha256Schema,
  })
  .strict();

export const AssetStorageSchema = z.discriminatedUnion("kind", [
  LocalAssetStorageSchema,
  GcsAssetStorageSchema,
]);
export type AssetStorage = z.infer<typeof AssetStorageSchema>;

export const SignAssetSchema = z
  .object({
    id: IdentifierSchema,
    intentId: ReceptionIntentIdSchema,
    assetVersion: VersionSchema,
    languagePack: LanguagePackSchema,
    region: z.literal("US"),
    dialect: z.literal("ASL"),
    sha256: Sha256Schema,
    mediaType: z.literal("video/mp4"),
    videoCodec: z.literal("h264"),
    durationMs: z.number().int().positive().max(60_000),
    width: z.literal(1920),
    height: z.literal(1080),
    frameRate: z.literal(30),
    muted: z.literal(true),
    wholeUtterance: z.literal(true),
    mirrored: z.literal(false),
    objectFit: z.literal("contain"),
    naturalPlaybackRate: z.literal(1),
    slowPlaybackApproved: z.boolean(),
    signerRef: SafeReferenceSchema.nullable(),
    approval: AssetApprovalSchema,
    rights: AssetRightsSchema,
    storage: AssetStorageSchema,
    playable: z.boolean(),
  })
  .strict()
  .superRefine((asset, context) => {
    const exactReview =
      asset.approval.status === "approved" &&
      asset.approval.reviewedSha256 === asset.sha256;
    const gcsHashMatches =
      asset.storage.kind !== "gcs" || asset.storage.metadataSha256 === asset.sha256;
    const canPlay =
      exactReview &&
      asset.rights.status === "cleared" &&
      asset.signerRef !== null &&
      asset.approval.status === "approved" &&
      asset.approval.reviewerRef !== asset.signerRef &&
      gcsHashMatches;

    if (asset.playable && !canPlay) {
      context.addIssue({
        code: "custom",
        path: ["playable"],
        message: "playable assets require exact-hash approval, signer/reviewer references, cleared rights, and verified storage metadata",
      });
    }
    if (asset.approval.status === "withdrawn" && asset.playable) {
      context.addIssue({
        code: "custom",
        path: ["playable"],
        message: "withdrawn assets can never be playable",
      });
    }
    if (
      asset.signerRef !== null &&
      asset.approval.status !== "draft" &&
      asset.approval.reviewerRef === asset.signerRef
    ) {
      context.addIssue({
        code: "custom",
        path: ["approval", "reviewerRef"],
        message: "the independent reviewer reference must differ from the signer reference",
      });
    }
  });
export type SignAsset = z.infer<typeof SignAssetSchema>;

export const CatalogIntentSchema = z
  .object({
    id: ReceptionIntentIdSchema,
    publicDescription: z.string().min(1).max(240),
    boundary: z.string().min(1).max(360),
    recordingStatus: z.enum(["not_recorded", "recorded"]),
    reviewStatus: z.enum(["not_reviewed", "approved", "withdrawn"]),
    assetId: IdentifierSchema.nullable(),
    playbackEnabled: z.boolean(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.playbackEnabled && (entry.assetId === null || entry.reviewStatus !== "approved")) {
      context.addIssue({
        code: "custom",
        path: ["playbackEnabled"],
        message: "playback requires an approved asset reference",
      });
    }
    if (entry.playbackEnabled && entry.recordingStatus !== "recorded") {
      context.addIssue({
        code: "custom",
        path: ["recordingStatus"],
        message: "playback requires a recorded whole-utterance asset",
      });
    }
    if (entry.assetId === null && (entry.recordingStatus !== "not_recorded" || entry.reviewStatus !== "not_reviewed")) {
      context.addIssue({
        code: "custom",
        path: ["assetId"],
        message: "an intent without an asset cannot claim recording or review",
      });
    }
    if (entry.assetId !== null && entry.recordingStatus !== "recorded") {
      context.addIssue({
        code: "custom",
        path: ["recordingStatus"],
        message: "an asset reference requires recordingStatus=recorded",
      });
    }
    if (entry.reviewStatus !== "not_reviewed" && entry.recordingStatus !== "recorded") {
      context.addIssue({
        code: "custom",
        path: ["reviewStatus"],
        message: "review status cannot advance before recording is complete",
      });
    }
  });
export type CatalogIntent = z.infer<typeof CatalogIntentSchema>;

export const CatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogVersion: VersionSchema,
    immutable: z.literal(true),
    status: z.enum(["draft", "published", "retired"]),
    languagePack: LanguagePackSchema,
    createdAt: IsoTimestampSchema,
    publishedAt: IsoTimestampSchema.nullable(),
    supersedes: VersionSchema.nullable(),
    playbackEnabled: z.boolean(),
    intents: z.array(CatalogIntentSchema).length(RECEPTION_INTENT_IDS.length),
    assets: z.array(SignAssetSchema).max(RECEPTION_INTENT_IDS.length),
  })
  .strict()
  .superRefine((catalog, context) => {
    const intentIds = catalog.intents.map((entry) => entry.id);
    const idSet = new Set(intentIds);
    if (idSet.size !== RECEPTION_INTENT_IDS.length || RECEPTION_INTENT_IDS.some((id) => !idSet.has(id))) {
      context.addIssue({
        code: "custom",
        path: ["intents"],
        message: "catalog must contain each server-owned reception intent exactly once",
      });
    }

    const assetsById = new Map(catalog.assets.map((asset) => [asset.id, asset]));
    if (assetsById.size !== catalog.assets.length) {
      context.addIssue({ code: "custom", path: ["assets"], message: "asset IDs must be unique" });
    }

    if (catalog.supersedes === catalog.catalogVersion) {
      context.addIssue({
        code: "custom",
        path: ["supersedes"],
        message: "a catalog version cannot supersede itself",
      });
    }

    const referencedAssetIds = new Set<string>();

    for (const [index, entry] of catalog.intents.entries()) {
      if (entry.assetId === null) {
        continue;
      }
      const asset = assetsById.get(entry.assetId);
      if (!asset || asset.intentId !== entry.id) {
        context.addIssue({
          code: "custom",
          path: ["intents", index, "assetId"],
          message: "asset reference must resolve to the same intent",
        });
        continue;
      }
      referencedAssetIds.add(asset.id);
      const expectedReviewStatus =
        asset.approval.status === "draft" ? "not_reviewed" : asset.approval.status;
      if (entry.reviewStatus !== expectedReviewStatus) {
        context.addIssue({
          code: "custom",
          path: ["intents", index, "reviewStatus"],
          message: "intent review status must match the referenced asset approval status",
        });
      }
      if (entry.playbackEnabled && !isPlayableSignAsset(asset, catalog.catalogVersion)) {
        context.addIssue({
          code: "custom",
          path: ["intents", index, "playbackEnabled"],
          message: "intent playback references an asset that is not valid for this catalog version",
        });
      }
    }

    for (const [index, asset] of catalog.assets.entries()) {
      if (!referencedAssetIds.has(asset.id)) {
        context.addIssue({
          code: "custom",
          path: ["assets", index, "id"],
          message: "every catalog asset must be referenced by its intent entry",
        });
      }
    }

    const createdAtMs = Date.parse(catalog.createdAt);
    const publishedAtMs = catalog.publishedAt === null ? null : Date.parse(catalog.publishedAt);
    if (publishedAtMs !== null && publishedAtMs < createdAtMs) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "publishedAt cannot precede createdAt",
      });
    }

    if (catalog.status === "published") {
      if (!catalog.publishedAt || !catalog.playbackEnabled) {
        context.addIssue({
          code: "custom",
          message: "a published catalog requires publishedAt and playbackEnabled",
        });
      }
      if (catalog.intents.some((entry) => !entry.playbackEnabled)) {
        context.addIssue({
          code: "custom",
          path: ["intents"],
          message: "a published launch catalog requires all ten reviewed phrases",
        });
      }
      if (catalog.assets.length !== RECEPTION_INTENT_IDS.length) {
        context.addIssue({
          code: "custom",
          path: ["assets"],
          message: "a published launch catalog requires exactly ten referenced assets",
        });
      }
    } else if (catalog.playbackEnabled || catalog.intents.some((entry) => entry.playbackEnabled)) {
      context.addIssue({
        code: "custom",
        path: ["playbackEnabled"],
        message: "draft and retired catalogs cannot enable playback",
      });
    }
    if (catalog.status === "draft" && catalog.publishedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "a draft catalog cannot claim a publication timestamp",
      });
    }
    if (catalog.status === "retired" && catalog.publishedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "a retired catalog must retain its original publication timestamp",
      });
    }
  });
export type Catalog = z.infer<typeof CatalogSchema>;

export function isPlayableSignAsset(asset: SignAsset, catalogVersion: string): boolean {
  return (
    asset.playable &&
    asset.signerRef !== null &&
    asset.approval.status === "approved" &&
    asset.approval.reviewerRef !== asset.signerRef &&
    asset.approval.catalogVersion === catalogVersion &&
    asset.approval.reviewedSha256 === asset.sha256 &&
    asset.rights.status === "cleared" &&
    (asset.storage.kind === "local" || asset.storage.metadataSha256 === asset.sha256)
  );
}

export function findCatalogIntent(
  catalog: Catalog,
  intentId: ReceptionIntentId,
): CatalogIntent | undefined {
  return catalog.intents.find((entry) => entry.id === intentId);
}
