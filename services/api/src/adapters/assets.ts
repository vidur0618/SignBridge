import { Storage } from "@google-cloud/storage";
import type { SignAsset } from "@signbridge/contracts";
import type { AppConfig } from "../config.js";

export interface SignedAsset {
  url: string;
  expiresAt: string;
}

export interface AssetSigner {
  sign(asset: SignAsset): Promise<SignedAsset>;
}

export class AssetUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetUnavailableError";
  }
}

export class LocalUnavailableAssetSigner implements AssetSigner {
  async sign(_asset: SignAsset): Promise<SignedAsset> {
    throw new AssetUnavailableError(
      "Signed ASL media is unavailable in local mode. No approval or review status is implied.",
    );
  }
}

export class GoogleCloudAssetSigner implements AssetSigner {
  readonly #storage: Storage;
  readonly #bucketName: string;
  readonly #ttlSeconds: number;

  constructor(config: AppConfig, storage?: Storage) {
    if (!config.googleCloudProject) throw new Error("GOOGLE_CLOUD_PROJECT is required for Cloud Storage");
    if (!config.signAssetBucket) throw new Error("SIGN_ASSET_BUCKET is required for Cloud Storage");
    this.#storage = storage ?? new Storage({ projectId: config.googleCloudProject });
    this.#bucketName = config.signAssetBucket;
    this.#ttlSeconds = config.signedUrlTtlSeconds;
  }

  async sign(asset: SignAsset): Promise<SignedAsset> {
    if (!asset.playable || asset.approval.status !== "approved") {
      throw new AssetUnavailableError("The ASL asset is not approved for playback");
    }
    if (asset.storage.kind !== "gcs" || asset.storage.bucket !== this.#bucketName) {
      throw new AssetUnavailableError("The ASL asset is not in the configured private bucket");
    }
    const file = this.#storage.bucket(this.#bucketName).file(asset.storage.object, {
      generation: asset.storage.generation,
    });
    const [exists] = await file.exists();
    if (!exists) throw new AssetUnavailableError("The ASL asset does not exist");
    const [metadata] = await file.getMetadata();
    const storedSha256 = metadata.metadata?.sha256;
    if (storedSha256 !== asset.sha256 || asset.storage.metadataSha256 !== asset.sha256) {
      throw new AssetUnavailableError("The ASL asset hash does not match its approved manifest");
    }
    if (metadata.contentType !== asset.mediaType) {
      throw new AssetUnavailableError("The ASL asset media type does not match its approved manifest");
    }

    const expires = Date.now() + this.#ttlSeconds * 1_000;
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires,
      responseType: asset.mediaType,
      responseDisposition: "inline",
    });
    return { url, expiresAt: new Date(expires).toISOString() };
  }
}
