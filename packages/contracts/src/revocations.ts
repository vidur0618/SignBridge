import { z } from "zod";

import {
  IdentifierSchema,
  IsoTimestampSchema,
  SafeReferenceSchema,
  Sha256Schema,
  VersionSchema,
} from "./common.js";

export const AssetRevocationEntrySchema = z
  .object({
    assetId: IdentifierSchema,
    assetSha256: Sha256Schema,
    catalogVersion: VersionSchema,
    withdrawnAt: IsoTimestampSchema,
    withdrawalRef: SafeReferenceSchema,
  })
  .strict();
export type AssetRevocationEntry = z.infer<typeof AssetRevocationEntrySchema>;

/**
 * Append-only withdrawal evidence is kept outside immutable catalog snapshots.
 * The service must consult the latest registry before minting every asset URL.
 */
export const AssetRevocationRegistrySchema = z
  .object({
    schemaVersion: z.literal(1),
    immutableEntries: z.literal(true),
    updatedAt: IsoTimestampSchema,
    entries: z.array(AssetRevocationEntrySchema).max(10_000),
  })
  .strict()
  .superRefine((registry, context) => {
    const keys = new Set<string>();
    const updatedAtMs = Date.parse(registry.updatedAt);
    for (const [index, entry] of registry.entries.entries()) {
      const key = `${entry.catalogVersion}:${entry.assetId}:${entry.assetSha256}`;
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index],
          message: "duplicate revocation entry",
        });
      }
      keys.add(key);
      if (Date.parse(entry.withdrawnAt) > updatedAtMs) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "withdrawnAt"],
          message: "withdrawnAt cannot be later than the registry update timestamp",
        });
      }
    }
  });
export type AssetRevocationRegistry = z.infer<typeof AssetRevocationRegistrySchema>;

export interface RevocableAssetIdentity {
  assetId: string;
  assetSha256: string;
  catalogVersion: string;
}

export function isAssetRevoked(
  registry: AssetRevocationRegistry,
  identity: RevocableAssetIdentity,
): boolean {
  const parsed = AssetRevocationRegistrySchema.parse(registry);
  return parsed.entries.some(
    (entry) =>
      entry.assetId === identity.assetId &&
      entry.assetSha256 === identity.assetSha256 &&
      entry.catalogVersion === identity.catalogVersion,
  );
}
