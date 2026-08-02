import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const catalogDirectory = resolve(repositoryRoot, "content", "catalog");

const INTENT_IDS = [
  "greeting",
  "offer_help",
  "request_name_and_host",
  "notify_host",
  "ask_wait",
  "explain_short_delay",
  "follow_staff",
  "offer_directions",
  "repeat_communication",
  "offer_alternatives",
];
const REQUIRED_RIGHTS_USES = [
  "commercial_pilot",
  "hosting",
  "contest_demo",
  "judge_access",
  "sponsor_publicity",
];
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/;
const PLACEHOLDER_PATTERN = /(?:^|[._:/-])(?:todo|tbd|placeholder|pending|unknown|unassigned|example)(?:$|[._:/-])/i;

const errors = [];
const catalogVersions = new Map();

function fail(file, path, message) {
  errors.push(`${file}:${path}: ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(file, path, value, requiredKeys) {
  if (!isRecord(value)) {
    fail(file, path, "must be an object");
    return false;
  }
  const expected = new Set(requiredKeys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) fail(file, `${path}.${key}`, "unknown field");
  }
  for (const key of expected) {
    if (!(key in value)) fail(file, `${path}.${key}`, "missing required field");
  }
  return true;
}

function validTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function validReference(value) {
  return typeof value === "string" && REFERENCE_PATTERN.test(value) && !PLACEHOLDER_PATTERN.test(value);
}

function hasEveryRight(uses) {
  return (
    Array.isArray(uses) &&
    uses.length === REQUIRED_RIGHTS_USES.length &&
    new Set(uses).size === REQUIRED_RIGHTS_USES.length &&
    REQUIRED_RIGHTS_USES.every((use) => uses.includes(use))
  );
}

function parseFrameRate(value) {
  if (typeof value !== "string") return Number.NaN;
  const [numerator, denominator = "1"] = value.split("/");
  const top = Number(numerator);
  const bottom = Number(denominator);
  return Number.isFinite(top) && Number.isFinite(bottom) && bottom !== 0
    ? top / bottom
    : Number.NaN;
}

function verifyLocalMediaStreams(file, path, assetPath) {
  const executable = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  const probe = spawnSync(
    executable,
    ["-v", "error", "-print_format", "json", "-show_streams", assetPath],
    { encoding: "utf8", windowsHide: true },
  );
  if (probe.error) {
    const unavailable = probe.error.code === "ENOENT";
    fail(
      file,
      path,
      unavailable
        ? `playable local assets require ffprobe; install FFmpeg or set FFPROBE_PATH (attempted ${executable})`
        : `ffprobe could not inspect the playable local asset: ${probe.error.message}`,
    );
    return false;
  }
  if (probe.status !== 0) {
    const detail = String(probe.stderr ?? "").trim() || `exit status ${String(probe.status)}`;
    fail(file, path, `ffprobe rejected the playable local asset: ${detail}`);
    return false;
  }

  let payload;
  try {
    payload = JSON.parse(probe.stdout);
  } catch {
    fail(file, path, "ffprobe returned invalid JSON for the playable local asset");
    return false;
  }
  if (!isRecord(payload) || !Array.isArray(payload.streams)) {
    fail(file, path, "ffprobe output did not contain a streams array");
    return false;
  }

  const videoStreams = payload.streams.filter((stream) => isRecord(stream) && stream.codec_type === "video");
  const audioStreams = payload.streams.filter((stream) => isRecord(stream) && stream.codec_type === "audio");
  if (videoStreams.length !== 1) {
    fail(file, path, `playable asset must contain exactly one video stream; found ${videoStreams.length}`);
    return false;
  }
  if (audioStreams.length !== 0) {
    fail(file, path, `muted playable asset must contain zero audio streams; found ${audioStreams.length}`);
    return false;
  }

  const video = videoStreams[0];
  const averageFrameRate = parseFrameRate(video.avg_frame_rate);
  const frameRate = Number.isFinite(averageFrameRate) && averageFrameRate > 0
    ? averageFrameRate
    : parseFrameRate(video.r_frame_rate);
  let valid = true;
  if (video.codec_name !== "h264") {
    fail(file, path, `video stream codec must be H.264; ffprobe reported ${String(video.codec_name)}`);
    valid = false;
  }
  if (video.width !== 1920 || video.height !== 1080) {
    fail(file, path, `video stream must be exactly 1920x1080; ffprobe reported ${String(video.width)}x${String(video.height)}`);
    valid = false;
  }
  if (!Number.isFinite(frameRate) || Math.abs(frameRate - 30) > 0.001) {
    fail(file, path, `video stream must be 30 fps; ffprobe reported ${String(video.avg_frame_rate || video.r_frame_rate)}`);
    valid = false;
  }
  return valid;
}

function validateStorage(file, path, storage, sha256, playable) {
  if (!isRecord(storage) || !["local", "gcs"].includes(storage.kind)) {
    fail(file, path, "storage.kind must be local or gcs");
    return false;
  }

  if (storage.kind === "local") {
    if (!exactKeys(file, path, storage, ["kind", "path", "sizeBytes"])) return false;
    if (typeof storage.path !== "string" || !storage.path.toLowerCase().endsWith(".mp4")) {
      fail(file, `${path}.path`, "must be a repository-relative MP4 path");
      return false;
    }
    if (isAbsolute(storage.path) || storage.path.split(/[\\/]/).includes("..")) {
      fail(file, `${path}.path`, "must not be absolute or traverse outside the repository");
      return false;
    }
    const assetPath = resolve(repositoryRoot, storage.path);
    const relativePath = relative(repositoryRoot, assetPath);
    if (relativePath.startsWith(`..${sep}`) || relativePath === "..") {
      fail(file, `${path}.path`, "resolves outside the repository");
      return false;
    }
    if (!existsSync(assetPath) || !statSync(assetPath).isFile()) {
      if (playable) fail(file, `${path}.path`, "playable local asset does not exist");
      return false;
    }
    const contents = readFileSync(assetPath);
    if (!Number.isInteger(storage.sizeBytes) || storage.sizeBytes !== contents.byteLength) {
      fail(file, `${path}.sizeBytes`, "does not match the local file byte length");
      return false;
    }
    if (contents.length < 12 || contents.subarray(4, 8).toString("ascii") !== "ftyp") {
      fail(file, `${path}.path`, "does not have an MP4 ftyp header");
      return false;
    }
    const actualDigest = createHash("sha256").update(contents).digest("hex");
    if (actualDigest !== sha256) {
      fail(file, `${path}.path`, `SHA-256 mismatch (actual ${actualDigest})`);
      return false;
    }
    if (playable && !verifyLocalMediaStreams(file, `${path}.path`, assetPath)) {
      return false;
    }
    return true;
  }

  if (!exactKeys(file, path, storage, [
    "kind",
    "bucket",
    "object",
    "generation",
    "sizeBytes",
    "crc32c",
    "etag",
    "metadataSha256",
  ])) return false;
  let valid = true;
  if (typeof storage.bucket !== "string" || !/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(storage.bucket)) {
    fail(file, `${path}.bucket`, "invalid GCS bucket name");
    valid = false;
  }
  if (typeof storage.object !== "string" || !storage.object || storage.object.startsWith("/") || storage.object.split("/").includes("..")) {
    fail(file, `${path}.object`, "invalid GCS object name");
    valid = false;
  }
  if (typeof storage.generation !== "string" || !/^[1-9][0-9]*$/.test(storage.generation)) {
    fail(file, `${path}.generation`, "explicit immutable GCS generation is required");
    valid = false;
  }
  if (!Number.isInteger(storage.sizeBytes) || storage.sizeBytes <= 0) {
    fail(file, `${path}.sizeBytes`, "must be a positive byte length");
    valid = false;
  }
  if (typeof storage.crc32c !== "string" || !/^[A-Za-z0-9+/]{6}==$/.test(storage.crc32c)) {
    fail(file, `${path}.crc32c`, "must be explicit four-byte base64 CRC32C metadata");
    valid = false;
  }
  if (typeof storage.etag !== "string" || !storage.etag.trim()) {
    fail(file, `${path}.etag`, "explicit GCS ETag is required");
    valid = false;
  }
  if (storage.metadataSha256 !== sha256) {
    fail(file, `${path}.metadataSha256`, "GCS object metadata SHA-256 must equal the reviewed asset hash");
    valid = false;
  }
  return valid;
}

function validateAsset(file, assetPath, asset, catalogVersion) {
  const keys = [
    "id", "intentId", "assetVersion", "languagePack", "region", "dialect", "sha256",
    "mediaType", "videoCodec", "durationMs", "width", "height", "frameRate", "muted", "wholeUtterance",
    "mirrored", "objectFit", "naturalPlaybackRate", "slowPlaybackApproved", "signerRef",
    "approval", "rights", "storage", "playable",
  ];
  if (!exactKeys(file, assetPath, asset, keys)) return { id: undefined, validForPlayback: false };

  if (typeof asset.id !== "string" || !asset.id) fail(file, `${assetPath}.id`, "asset ID is required");
  if (!INTENT_IDS.includes(asset.intentId)) fail(file, `${assetPath}.intentId`, "unknown reception intent");
  if (!VERSION_PATTERN.test(asset.assetVersion ?? "")) fail(file, `${assetPath}.assetVersion`, "invalid immutable asset version");
  if (!SHA256_PATTERN.test(asset.sha256 ?? "")) fail(file, `${assetPath}.sha256`, "must be a lowercase SHA-256 digest");
  if (
    asset.languagePack !== "ase-US" || asset.region !== "US" || asset.dialect !== "ASL" ||
    asset.mediaType !== "video/mp4" || asset.videoCodec !== "h264" || asset.muted !== true || asset.wholeUtterance !== true ||
    asset.mirrored !== false || asset.objectFit !== "contain" || asset.naturalPlaybackRate !== 1 ||
    ![true, false].includes(asset.slowPlaybackApproved) || !Number.isInteger(asset.durationMs) ||
    asset.durationMs <= 0 || asset.durationMs > 60_000 || asset.width !== 1920 ||
    asset.height !== 1080 || asset.frameRate !== 30
  ) {
    fail(file, assetPath, "media metadata must declare muted H.264 MP4 at exactly 1920x1080/30 fps with whole-utterance, no-crop, no-mirror presentation");
  }

  const approval = asset.approval;
  let approvalValid = false;
  if (!isRecord(approval) || !["draft", "approved", "withdrawn"].includes(approval.status)) {
    fail(file, `${assetPath}.approval`, "invalid approval status");
  } else if (approval.status === "draft") {
    exactKeys(file, `${assetPath}.approval`, approval, ["status", "reviewerRef", "reviewedSha256", "catalogVersion", "reviewedAt"]);
    if ([approval.reviewerRef, approval.reviewedSha256, approval.catalogVersion, approval.reviewedAt].some((value) => value !== null)) {
      fail(file, `${assetPath}.approval`, "draft approval fields must be null; do not fabricate review provenance");
    }
  } else {
    const approvalKeys = ["status", "reviewerRef", "reviewedSha256", "catalogVersion", "reviewedAt"];
    if (approval.status === "withdrawn") approvalKeys.push("withdrawnAt", "withdrawalRef");
    exactKeys(file, `${assetPath}.approval`, approval, approvalKeys);
    approvalValid =
      validReference(approval.reviewerRef) &&
      approval.reviewedSha256 === asset.sha256 &&
      approval.catalogVersion === catalogVersion &&
      validTimestamp(approval.reviewedAt);
    if (!validReference(approval.reviewerRef)) fail(file, `${assetPath}.approval.reviewerRef`, "real consent-safe reviewer reference required");
    if (approval.reviewedSha256 !== asset.sha256) fail(file, `${assetPath}.approval.reviewedSha256`, "review must bind the exact asset SHA-256");
    if (approval.catalogVersion !== catalogVersion) fail(file, `${assetPath}.approval.catalogVersion`, "review must bind the exact catalog version");
    if (!validTimestamp(approval.reviewedAt)) fail(file, `${assetPath}.approval.reviewedAt`, "valid review timestamp required");
    if (approval.status === "withdrawn") {
      approvalValid = false;
      if (!validTimestamp(approval.withdrawnAt) || !validReference(approval.withdrawalRef)) {
        fail(file, `${assetPath}.approval`, "withdrawn asset requires timestamp and audit reference");
      }
    }
  }

  const rights = asset.rights;
  let rightsValid = false;
  if (!isRecord(rights) || !["uncleared", "cleared"].includes(rights.status)) {
    fail(file, `${assetPath}.rights`, "invalid rights status");
  } else {
    exactKeys(file, `${assetPath}.rights`, rights, ["status", "rightsRef", "coveredUses"]);
    if (rights.status === "uncleared") {
      if (rights.rightsRef !== null || !Array.isArray(rights.coveredUses) || rights.coveredUses.length !== 0) {
        fail(file, `${assetPath}.rights`, "uncleared rights cannot claim a reference or covered uses");
      }
    } else {
      rightsValid = validReference(rights.rightsRef) && hasEveryRight(rights.coveredUses);
      if (!validReference(rights.rightsRef)) fail(file, `${assetPath}.rights.rightsRef`, "real consent-safe rights reference required");
      if (!hasEveryRight(rights.coveredUses)) fail(file, `${assetPath}.rights.coveredUses`, "must contain every required use exactly once");
    }
  }

  const signerValid = validReference(asset.signerRef);
  if (asset.playable && !signerValid) fail(file, `${assetPath}.signerRef`, "playback requires a real consent-safe signer reference");
  const independentlyReviewed =
    approval?.status !== "draft" && signerValid && approval?.reviewerRef !== asset.signerRef;
  if (approval?.status !== "draft" && signerValid && !independentlyReviewed) {
    fail(file, `${assetPath}.approval.reviewerRef`, "independent reviewer reference must differ from signer reference");
  }
  const storageValid = validateStorage(file, `${assetPath}.storage`, asset.storage, asset.sha256, asset.playable === true);
  const validForPlayback =
    asset.playable === true && approval?.status === "approved" && approvalValid && rightsValid &&
    signerValid && independentlyReviewed && storageValid;

  if (asset.playable && !validForPlayback) {
    fail(file, `${assetPath}.playable`, "cannot enable playback without exact review, rights, signer, and storage evidence");
  }
  if (approval?.status === "withdrawn" && asset.playable) {
    fail(file, `${assetPath}.playable`, "withdrawn assets must be disabled immediately");
  }
  return { id: asset.id, intentId: asset.intentId, approvalStatus: approval?.status, validForPlayback };
}

function validateCatalog(file, catalog) {
  const rootKeys = [
    "schemaVersion", "catalogVersion", "immutable", "status", "languagePack", "createdAt",
    "publishedAt", "supersedes", "playbackEnabled", "intents", "assets",
  ];
  if (!exactKeys(file, "$", catalog, rootKeys)) return;
  if (catalog.schemaVersion !== 1) fail(file, "$.schemaVersion", "must equal 1");
  if (!VERSION_PATTERN.test(catalog.catalogVersion ?? "")) fail(file, "$.catalogVersion", "invalid immutable version label");
  if (catalog.immutable !== true) fail(file, "$.immutable", "catalog versions must be immutable");
  if (!["draft", "published", "retired"].includes(catalog.status)) fail(file, "$.status", "invalid catalog status");
  if (catalog.languagePack !== "ase-US") fail(file, "$.languagePack", "launch catalog is ase-US only");
  if (!validTimestamp(catalog.createdAt)) fail(file, "$.createdAt", "valid timestamp required");
  if (catalog.supersedes !== null && !VERSION_PATTERN.test(catalog.supersedes ?? "")) fail(file, "$.supersedes", "invalid superseded version");
  if (catalog.supersedes === catalog.catalogVersion) fail(file, "$.supersedes", "catalog cannot supersede itself");

  const priorFile = catalogVersions.get(catalog.catalogVersion);
  if (priorFile) fail(file, "$.catalogVersion", `version is already declared by ${priorFile}`);
  else catalogVersions.set(catalog.catalogVersion, file);

  if (!Array.isArray(catalog.assets)) {
    fail(file, "$.assets", "must be an array");
    return;
  }
  const assetResults = catalog.assets.map((asset, index) => validateAsset(file, `$.assets[${index}]`, asset, catalog.catalogVersion));
  const assetsById = new Map();
  for (const asset of assetResults) {
    if (asset.id && assetsById.has(asset.id)) fail(file, "$.assets", `duplicate asset ID: ${asset.id}`);
    else if (asset.id) assetsById.set(asset.id, asset);
  }

  if (!Array.isArray(catalog.intents) || catalog.intents.length !== INTENT_IDS.length) {
    fail(file, "$.intents", `must contain exactly ${INTENT_IDS.length} entries`);
    return;
  }
  const seenIntents = new Set();
  const referencedAssets = new Set();
  for (const [index, entry] of catalog.intents.entries()) {
    const entryPath = `$.intents[${index}]`;
    if (!exactKeys(file, entryPath, entry, ["id", "publicDescription", "boundary", "recordingStatus", "reviewStatus", "assetId", "playbackEnabled"])) continue;
    if (!INTENT_IDS.includes(entry.id) || seenIntents.has(entry.id)) fail(file, `${entryPath}.id`, "unknown or duplicate intent ID");
    seenIntents.add(entry.id);
    if (typeof entry.publicDescription !== "string" || !entry.publicDescription.trim()) fail(file, `${entryPath}.publicDescription`, "description required");
    if (typeof entry.boundary !== "string" || !entry.boundary.trim()) fail(file, `${entryPath}.boundary`, "scope boundary required");
    if (!["not_recorded", "recorded"].includes(entry.recordingStatus)) fail(file, `${entryPath}.recordingStatus`, "invalid status");
    if (!["not_reviewed", "approved", "withdrawn"].includes(entry.reviewStatus)) fail(file, `${entryPath}.reviewStatus`, "invalid status");
    if (entry.assetId === null) {
      if (entry.recordingStatus !== "not_recorded" || entry.reviewStatus !== "not_reviewed" || entry.playbackEnabled !== false) {
        fail(file, entryPath, "an intent without an asset cannot claim recording, review, or playback");
      }
      continue;
    }
    const asset = assetsById.get(entry.assetId);
    referencedAssets.add(entry.assetId);
    if (!asset || asset.intentId !== entry.id) fail(file, `${entryPath}.assetId`, "must resolve to an asset for the same intent");
    if (entry.recordingStatus !== "recorded") {
      fail(file, `${entryPath}.recordingStatus`, "an asset reference requires recordingStatus=recorded");
    }
    const expectedReviewStatus = asset?.approvalStatus === "draft" ? "not_reviewed" : asset?.approvalStatus;
    if (asset && entry.reviewStatus !== expectedReviewStatus) {
      fail(file, `${entryPath}.reviewStatus`, "must match the referenced asset approval status");
    }
    if (entry.playbackEnabled && (!asset?.validForPlayback || entry.reviewStatus !== "approved")) {
      fail(file, `${entryPath}.playbackEnabled`, "playback requires the exact valid approved asset");
    }
    if (entry.playbackEnabled && entry.recordingStatus !== "recorded") {
      fail(file, `${entryPath}.recordingStatus`, "playback requires a recorded whole-utterance asset");
    }
  }
  for (const expectedId of INTENT_IDS) {
    if (!seenIntents.has(expectedId)) fail(file, "$.intents", `missing server-owned intent: ${expectedId}`);
  }
  for (const asset of assetResults) {
    if (asset.id && !referencedAssets.has(asset.id)) fail(file, "$.assets", `asset is not referenced: ${asset.id}`);
  }

  const createdAtMs = Date.parse(catalog.createdAt);
  const publishedAtMs = catalog.publishedAt === null ? null : Date.parse(catalog.publishedAt);
  if (publishedAtMs !== null && publishedAtMs < createdAtMs) {
    fail(file, "$.publishedAt", "cannot precede createdAt");
  }

  if (catalog.status === "published") {
    if (!validTimestamp(catalog.publishedAt) || catalog.playbackEnabled !== true) {
      fail(file, "$", "published catalog requires publishedAt and playbackEnabled=true");
    }
    if (catalog.intents.some((entry) => entry.playbackEnabled !== true)) {
      fail(file, "$.intents", "published launch catalog requires all ten reviewed phrases");
    }
    if (catalog.assets.length !== INTENT_IDS.length) {
      fail(file, "$.assets", "published launch catalog requires exactly ten referenced assets");
    }
  } else {
    if (catalog.publishedAt !== null && catalog.status === "draft") fail(file, "$.publishedAt", "draft catalog cannot claim publication");
    if (catalog.playbackEnabled !== false || catalog.intents.some((entry) => entry.playbackEnabled !== false)) {
      fail(file, "$.playbackEnabled", "draft and retired catalogs must disable playback");
    }
    if (catalog.status === "retired" && !validTimestamp(catalog.publishedAt)) {
      fail(file, "$.publishedAt", "retired catalog must retain its original publication timestamp");
    }
  }
}

if (!existsSync(catalogDirectory)) {
  console.error(`Catalog directory not found: ${catalogDirectory}`);
  process.exit(1);
}

const files = readdirSync(catalogDirectory).filter((file) => file.endsWith(".json")).sort();
if (files.length === 0) {
  console.error("No catalog JSON files found.");
  process.exit(1);
}

for (const file of files) {
  try {
    const catalog = JSON.parse(readFileSync(resolve(catalogDirectory, file), "utf8"));
    validateCatalog(file, catalog);
  } catch (error) {
    fail(file, "$", error instanceof Error ? error.message : String(error));
  }
}

if (errors.length > 0) {
  console.error(`Catalog verification failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Verified ${files.length} immutable catalog file(s). Draft catalogs remain non-playable.`);
