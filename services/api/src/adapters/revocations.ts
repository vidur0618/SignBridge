import { readFile } from "node:fs/promises";
import {
  AssetRevocationRegistrySchema,
  type AssetRevocationRegistry,
} from "@signbridge/contracts";

export interface RevocationRepository {
  current(): Promise<AssetRevocationRegistry>;
}

/** Re-reads on every decision so an operator can revoke without restarting a local service. */
export class FileRevocationRepository implements RevocationRepository {
  readonly #path: string | undefined;

  constructor(path?: string) {
    this.#path = path;
  }

  async current(): Promise<AssetRevocationRegistry> {
    if (!this.#path) {
      return {
        schemaVersion: 1,
        immutableEntries: true,
        updatedAt: new Date().toISOString(),
        entries: [],
      };
    }
    return AssetRevocationRegistrySchema.parse(
      JSON.parse(await readFile(this.#path, "utf8")) as unknown,
    );
  }
}
