export type SupportedUploadMimeType = "audio/wav" | "audio/mpeg" | "audio/webm";

/**
 * Returns a duration derived from the uploaded bytes, never from client metadata.
 * A null result is deliberately fail-closed: unverifiable audio must not be sent
 * to Speech-to-Text where it could evade the one-minute quota boundary.
 */
export function inspectAudioDurationMs(
  bytes: Buffer,
  mimeType: SupportedUploadMimeType,
): number | null {
  const duration =
    mimeType === "audio/wav"
      ? inspectWavDurationMs(bytes)
      : mimeType === "audio/mpeg"
        ? inspectMp3DurationMs(bytes)
        : inspectWebmDurationMs(bytes);
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.ceil(duration);
}

function inspectWavDurationMs(bytes: Buffer): number | null {
  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }
  const declaredEnd = bytes.readUInt32LE(4) + 8;
  if (declaredEnd < 12 || declaredEnd > bytes.length) return null;

  let byteRate: number | null = null;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= declaredEnd) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > declaredEnd) return null;
    if (id === "fmt ") {
      if (size < 16) return null;
      const audioFormat = bytes.readUInt16LE(dataStart);
      const channels = bytes.readUInt16LE(dataStart + 2);
      const sampleRate = bytes.readUInt32LE(dataStart + 4);
      const declaredByteRate = bytes.readUInt32LE(dataStart + 8);
      const blockAlign = bytes.readUInt16LE(dataStart + 12);
      const bitsPerSample = bytes.readUInt16LE(dataStart + 14);
      const expectedBlockAlign = channels * (bitsPerSample / 8);
      if (
        (audioFormat !== 1 && audioFormat !== 3) ||
        channels < 1 ||
        channels > 8 ||
        sampleRate < 8_000 ||
        sampleRate > 192_000 ||
        ![8, 16, 24, 32, 64].includes(bitsPerSample) ||
        !Number.isInteger(expectedBlockAlign) ||
        blockAlign !== expectedBlockAlign ||
        declaredByteRate !== sampleRate * blockAlign
      ) {
        return null;
      }
      byteRate = declaredByteRate;
    } else if (id === "data") {
      dataBytes += size;
    }
    offset = dataEnd + (size % 2);
  }
  if (byteRate == null || byteRate <= 0 || dataBytes <= 0) return null;
  return (dataBytes / byteRate) * 1_000;
}

const MPEG1_BITRATES = {
  1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
} as const;
const MPEG2_BITRATES = {
  1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
} as const;

function inspectMp3DurationMs(bytes: Buffer): number | null {
  let offset = skipId3v2(bytes);
  if (offset < 0) return null;
  let durationMs = 0;
  let frameCount = 0;

  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    if (remaining === 128 && bytes.toString("ascii", offset, offset + 3) === "TAG") break;
    if (remaining < 4) {
      if (bytes.subarray(offset).every((value) => value === 0)) break;
      return null;
    }

    const header = bytes.readUInt32BE(offset);
    if ((header >>> 21) !== 0x7ff) {
      if (bytes.subarray(offset).every((value) => value === 0)) break;
      return null;
    }
    const versionBits = (header >>> 19) & 0b11;
    const layerBits = (header >>> 17) & 0b11;
    const bitrateIndex = (header >>> 12) & 0b1111;
    const sampleRateIndex = (header >>> 10) & 0b11;
    const padding = (header >>> 9) & 1;
    if (
      versionBits === 0b01 ||
      layerBits === 0 ||
      bitrateIndex === 0 ||
      bitrateIndex === 0b1111 ||
      sampleRateIndex === 0b11
    ) {
      return null;
    }

    const layer = (4 - layerBits) as 1 | 2 | 3;
    const isMpeg1 = versionBits === 0b11;
    const sampleRates =
      versionBits === 0b11
        ? [44_100, 48_000, 32_000]
        : versionBits === 0b10
          ? [22_050, 24_000, 16_000]
          : [11_025, 12_000, 8_000];
    const sampleRate = sampleRates[sampleRateIndex];
    const bitrateKbps = (isMpeg1 ? MPEG1_BITRATES : MPEG2_BITRATES)[layer][bitrateIndex];
    if (!sampleRate || !bitrateKbps) return null;

    const bitrate = bitrateKbps * 1_000;
    const frameLength =
      layer === 1
        ? Math.floor((12 * bitrate) / sampleRate + padding) * 4
        : layer === 3 && !isMpeg1
          ? Math.floor((72 * bitrate) / sampleRate + padding)
          : Math.floor((144 * bitrate) / sampleRate + padding);
    const samplesPerFrame = layer === 1 ? 384 : layer === 3 && !isMpeg1 ? 576 : 1_152;
    if (frameLength < 4 || offset + frameLength > bytes.length) return null;

    durationMs += (samplesPerFrame / sampleRate) * 1_000;
    frameCount += 1;
    offset += frameLength;
  }
  return frameCount > 0 ? durationMs : null;
}

function skipId3v2(bytes: Buffer): number {
  if (bytes.length < 3 || bytes.toString("ascii", 0, 3) !== "ID3") return 0;
  if (bytes.length < 10) return -1;
  const sizeBytes = bytes.subarray(6, 10);
  if (sizeBytes.some((value) => (value & 0x80) !== 0)) return -1;
  const size =
    (sizeBytes[0]! << 21) |
    (sizeBytes[1]! << 14) |
    (sizeBytes[2]! << 7) |
    sizeBytes[3]!;
  const footerBytes = bytes[3] === 4 && (bytes[5]! & 0x10) !== 0 ? 10 : 0;
  const offset = 10 + size + footerBytes;
  return offset <= bytes.length ? offset : -1;
}

interface EbmlValue {
  length: number;
  value: number;
  unknown: boolean;
}

function readEbmlValue(bytes: Buffer, offset: number, retainMarker: boolean): EbmlValue | null {
  const first = bytes[offset];
  if (first == null || first === 0) return null;
  let marker = 0x80;
  let length = 1;
  while ((first & marker) === 0 && length <= 8) {
    marker >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  let value = retainMarker ? first : first & (marker - 1);
  let unknown = !retainMarker && (first & (marker - 1)) === marker - 1;
  for (let index = 1; index < length; index += 1) {
    const next = bytes[offset + index]!;
    value = value * 256 + next;
    unknown = unknown && next === 0xff;
  }
  return { length, value, unknown };
}

function inspectWebmDurationMs(bytes: Buffer): number | null {
  const EBML = 0x1a45dfa3;
  const SEGMENT = 0x18538067;
  const INFO = 0x1549a966;
  const TIMESTAMP_SCALE = 0x2ad7b1;
  const DURATION = 0x4489;
  let offset = 0;
  let sawHeader = false;

  while (offset < bytes.length) {
    const id = readEbmlValue(bytes, offset, true);
    if (!id) return null;
    const size = readEbmlValue(bytes, offset + id.length, false);
    if (!size) return null;
    const dataStart = offset + id.length + size.length;
    const dataEnd = size.unknown ? bytes.length : dataStart + size.value;
    if (dataEnd > bytes.length) return null;
    if (id.value === EBML) sawHeader = true;
    if (id.value === SEGMENT && sawHeader) {
      let childOffset = dataStart;
      while (childOffset < dataEnd) {
        const childId = readEbmlValue(bytes, childOffset, true);
        if (!childId) return null;
        const childSize = readEbmlValue(bytes, childOffset + childId.length, false);
        if (!childSize) return null;
        const childStart = childOffset + childId.length + childSize.length;
        const childEnd = childSize.unknown ? dataEnd : childStart + childSize.value;
        if (childEnd > dataEnd) return null;
        if (childId.value === INFO) {
          let infoOffset = childStart;
          let timestampScale = 1_000_000;
          let duration: number | null = null;
          while (infoOffset < childEnd) {
            const infoId = readEbmlValue(bytes, infoOffset, true);
            if (!infoId) return null;
            const infoSize = readEbmlValue(bytes, infoOffset + infoId.length, false);
            if (!infoSize || infoSize.unknown) return null;
            const infoStart = infoOffset + infoId.length + infoSize.length;
            const infoEnd = infoStart + infoSize.value;
            if (infoEnd > childEnd) return null;
            if (infoId.value === TIMESTAMP_SCALE) {
              if (infoSize.value < 1 || infoSize.value > 8) return null;
              timestampScale = 0;
              for (let index = infoStart; index < infoEnd; index += 1) {
                timestampScale = timestampScale * 256 + bytes[index]!;
              }
            } else if (infoId.value === DURATION) {
              duration =
                infoSize.value === 4
                  ? bytes.readFloatBE(infoStart)
                  : infoSize.value === 8
                    ? bytes.readDoubleBE(infoStart)
                    : null;
            }
            infoOffset = infoEnd;
          }
          if (duration != null && duration > 0 && timestampScale > 0) {
            return (duration * timestampScale) / 1_000_000;
          }
          return null;
        }
        childOffset = childEnd;
      }
      return null;
    }
    offset = dataEnd;
  }
  return null;
}
