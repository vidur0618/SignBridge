import type { Catalog, SignAsset } from "./catalog.js";
import { CatalogSchema, isPlayableSignAsset } from "./catalog.js";
import {
  RenderSegmentSchema,
  SignPlanSchema,
  StableUtteranceSchema,
  TranscriptSegmentSchema,
  type DetectedIntent,
  type RenderSegment,
  type SignPlan,
  type StableUtterance,
  type TranscriptSegment,
} from "./core.js";
import {
  isAssetRevoked,
  type AssetRevocationRegistry,
} from "./revocations.js";

export interface CreateStableUtteranceInput {
  id: string;
  sessionId: string;
  segments: readonly TranscriptSegment[];
  finalizedAt: string;
}

/**
 * The sole ASR-to-utterance constructor. It deliberately refuses to promote a
 * partial hypothesis, even if that hypothesis contains plausible text.
 */
export function createStableUtterance(input: CreateStableUtteranceInput): StableUtterance {
  if (input.segments.length === 0) {
    throw new Error("A stable utterance requires at least one final ASR segment.");
  }

  const segments = input.segments.map((segment) => TranscriptSegmentSchema.parse(segment));
  if (segments.some((segment) => segment.state !== "final")) {
    throw new Error("Partial transcript segments cannot create a stable utterance.");
  }
  if (segments.some((segment) => segment.sessionId !== input.sessionId)) {
    throw new Error("All transcript segments must belong to the stable utterance session.");
  }

  const ordered = [...segments].sort((left, right) => left.sequence - right.sequence);
  if (new Set(ordered.map((segment) => segment.id)).size !== ordered.length) {
    throw new Error("Transcript segment IDs must be unique.");
  }

  return StableUtteranceSchema.parse({
    id: input.id,
    sessionId: input.sessionId,
    segmentIds: ordered.map((segment) => segment.id),
    transcript: ordered.map((segment) => segment.text).join(" ").trim(),
    isFinal: true,
    finalizationReason: "asr_is_final",
    finalizedAt: input.finalizedAt,
  });
}

export interface CreateSignPlanInput {
  id: string;
  createdAt: string;
  utterance: StableUtterance;
  detectedIntent: DetectedIntent;
  catalog: Catalog;
  revocations?: AssetRevocationRegistry;
}

/**
 * Resolves one approved whole-utterance asset. It cannot concatenate signs and
 * cannot create a plan from an unsupported candidate or unpublished catalog.
 */
export function createSignPlan(input: CreateSignPlanInput): SignPlan {
  const utterance = StableUtteranceSchema.parse(input.utterance);
  const catalog = CatalogSchema.parse(input.catalog);
  const candidate = input.detectedIntent;

  if (candidate.status !== "supported") {
    throw new Error("Unsupported intent candidates cannot create a sign plan.");
  }
  if (candidate.utteranceId !== utterance.id) {
    throw new Error("Intent candidate and stable utterance IDs do not match.");
  }
  if (catalog.status !== "published" || !catalog.playbackEnabled) {
    throw new Error("Only a published, playback-enabled catalog can create a sign plan.");
  }

  const entry = catalog.intents.find((item) => item.id === candidate.intentId);
  const asset = entry?.assetId
    ? catalog.assets.find((item): item is SignAsset => item.id === entry.assetId)
    : undefined;
  if (!entry?.playbackEnabled || !asset || !isPlayableSignAsset(asset, catalog.catalogVersion)) {
    throw new Error("No exact, approved, rights-cleared asset is playable for this intent.");
  }
  if (
    input.revocations &&
    isAssetRevoked(input.revocations, {
      assetId: asset.id,
      assetSha256: asset.sha256,
      catalogVersion: catalog.catalogVersion,
    })
  ) {
    throw new Error("The approved asset has been withdrawn and cannot create a sign plan.");
  }
  if (asset.approval.status !== "approved" || asset.rights.status !== "cleared") {
    throw new Error("Asset approval or rights status changed during plan creation.");
  }

  return SignPlanSchema.parse({
    id: input.id,
    utteranceId: utterance.id,
    intentId: candidate.intentId,
    assetId: asset.id,
    catalogVersion: catalog.catalogVersion,
    languagePack: catalog.languagePack,
    caption: utterance.transcript,
    approvalProvenance: {
      reviewerRef: asset.approval.reviewerRef,
      reviewedSha256: asset.approval.reviewedSha256,
      rightsRef: asset.rights.rightsRef,
      reviewedAt: asset.approval.reviewedAt,
    },
    fallbackRule: "captions_only",
    wholeUtterance: true,
    staffConfirmation: "required",
    createdAt: input.createdAt,
  });
}

export interface CreateRenderSegmentInput {
  id: string;
  signPlan: SignPlan;
  catalog: Catalog;
  caption: string;
  videoUrl: string;
  urlExpiresAt: string;
  playbackRate: 1 | 0.75;
  revocations?: AssetRevocationRegistry;
}

/**
 * Creates the only render payload that may reach the video element. It binds
 * the render to the approved asset and caption selected by the sign plan; a
 * caller cannot independently change the caption, asset, or playback policy.
 */
export function createRenderSegment(input: CreateRenderSegmentInput): RenderSegment {
  const signPlan = SignPlanSchema.parse(input.signPlan);
  const catalog = CatalogSchema.parse(input.catalog);
  if (catalog.status !== "published" || !catalog.playbackEnabled) {
    throw new Error("Only the published, playback-enabled catalog can create a render segment.");
  }
  if (
    signPlan.catalogVersion !== catalog.catalogVersion ||
    signPlan.languagePack !== catalog.languagePack
  ) {
    throw new Error("Sign plan and catalog versions do not match.");
  }

  const entry = catalog.intents.find((item) => item.id === signPlan.intentId);
  const asset = catalog.assets.find((item): item is SignAsset => item.id === signPlan.assetId);
  if (
    !entry?.playbackEnabled ||
    entry.assetId !== signPlan.assetId ||
    !asset ||
    asset.intentId !== signPlan.intentId ||
    !isPlayableSignAsset(asset, catalog.catalogVersion)
  ) {
    throw new Error("Sign plan does not resolve to the current approved asset.");
  }
  if (
    input.revocations &&
    isAssetRevoked(input.revocations, {
      assetId: asset.id,
      assetSha256: asset.sha256,
      catalogVersion: catalog.catalogVersion,
    })
  ) {
    throw new Error("The approved asset has been withdrawn and cannot be rendered.");
  }
  if (
    asset.approval.status !== "approved" ||
    asset.rights.status !== "cleared" ||
    signPlan.approvalProvenance.reviewerRef !== asset.approval.reviewerRef ||
    signPlan.approvalProvenance.reviewedSha256 !== asset.sha256 ||
    signPlan.approvalProvenance.reviewedAt !== asset.approval.reviewedAt ||
    signPlan.approvalProvenance.rightsRef !== asset.rights.rightsRef
  ) {
    throw new Error("Sign plan approval provenance does not match the exact asset.");
  }
  if (input.caption !== signPlan.caption) {
    throw new Error("Render caption must equal the finalized sign-plan caption.");
  }
  if (input.playbackRate === 0.75 && !asset.slowPlaybackApproved) {
    throw new Error("Slow playback has not been approved for this exact asset.");
  }
  if (Date.parse(input.urlExpiresAt) <= Date.parse(signPlan.createdAt)) {
    throw new Error("Signed asset URL must expire after sign-plan creation.");
  }

  return RenderSegmentSchema.parse({
    id: input.id,
    signPlanId: signPlan.id,
    utteranceId: signPlan.utteranceId,
    assetId: asset.id,
    caption: signPlan.caption,
    videoUrl: input.videoUrl,
    urlExpiresAt: input.urlExpiresAt,
    playbackRate: input.playbackRate,
    playbackState: "ready",
    objectFit: "contain",
    mirrored: false,
    captionsVisible: true,
  });
}
