import { readFile } from "node:fs/promises";
import {
  CatalogSchema,
  findCatalogIntent,
  isPlayableSignAsset,
  type Catalog,
  type ReceptionIntentId,
  type SignAsset,
} from "@signbridge/contracts";

export interface CatalogRepository {
  current(): Catalog;
  assetForIntent(intentId: ReceptionIntentId): SignAsset | null;
}

export class InMemoryCatalogRepository implements CatalogRepository {
  readonly #catalog: Catalog;

  constructor(catalog: Catalog) {
    this.#catalog = CatalogSchema.parse(catalog);
  }

  current(): Catalog {
    return this.#catalog;
  }

  assetForIntent(intentId: ReceptionIntentId): SignAsset | null {
    const entry = findCatalogIntent(this.#catalog, intentId);
    if (!entry?.assetId || !entry.playbackEnabled) return null;
    const asset = this.#catalog.assets.find((candidate) => candidate.id === entry.assetId);
    if (!asset || !isPlayableSignAsset(asset, this.#catalog.catalogVersion)) return null;
    return asset;
  }
}

export async function loadCatalog(path: string | undefined): Promise<CatalogRepository> {
  if (!path) {
    throw new Error("SIGN_CATALOG_PATH must point to an explicit draft or published catalog");
  }
  const bytes = await readFile(path);
  const parsed = CatalogSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
  return new InMemoryCatalogRepository(parsed);
}
