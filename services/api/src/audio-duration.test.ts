import { describe, expect, it } from "vitest";
import { inspectAudioDurationMs } from "./audio-duration.js";

describe("server-owned audio duration inspection", () => {
  it("derives WAV duration from validated RIFF chunks", () => {
    expect(inspectAudioDurationMs(makeWav(8_000), "audio/wav")).toBe(1_000);
    expect(inspectAudioDurationMs(makeWav(480_008), "audio/wav")).toBe(60_001);
    const inconsistent = makeWav(80_000);
    inconsistent.writeUInt32LE(8_000_000, 28);
    expect(inspectAudioDurationMs(inconsistent, "audio/wav")).toBeNull();
  });

  it("sums MPEG frame durations instead of trusting upload metadata", () => {
    const frame = Buffer.alloc(417);
    frame.set([0xff, 0xfb, 0x90, 0x00]); // MPEG-1 Layer III, 128 kbps, 44.1 kHz.
    const mp3 = Buffer.concat(Array.from({ length: 40 }, () => frame));
    expect(inspectAudioDurationMs(mp3, "audio/mpeg")).toBe(1_045);
  });

  it("reads a WebM Segment Info duration and fails closed without it", () => {
    expect(inspectAudioDurationMs(makeWebm(30_000), "audio/webm")).toBe(30_000);
    expect(inspectAudioDurationMs(makeWebm(60_001), "audio/webm")).toBe(60_001);
    expect(inspectAudioDurationMs(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]), "audio/webm"))
      .toBeNull();
  });

  it("rejects malformed or unverifiable bytes for every accepted MIME type", () => {
    const malformed = Buffer.from("not audio");
    expect(inspectAudioDurationMs(malformed, "audio/wav")).toBeNull();
    expect(inspectAudioDurationMs(malformed, "audio/mpeg")).toBeNull();
    expect(inspectAudioDurationMs(malformed, "audio/webm")).toBeNull();
  });
});

function makeWav(dataBytes: number): Buffer {
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8_000, 24);
  bytes.writeUInt32LE(8_000, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
}

function makeWebm(durationMs: number): Buffer {
  const scale = Buffer.from([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]);
  const duration = Buffer.alloc(11);
  duration.set([0x44, 0x89, 0x88]);
  duration.writeDoubleBE(durationMs, 3);
  const infoPayload = Buffer.concat([scale, duration]);
  const info = Buffer.concat([Buffer.from([0x15, 0x49, 0xa9, 0x66, 0x80 | infoPayload.length]), infoPayload]);
  const segment = Buffer.concat([Buffer.from([0x18, 0x53, 0x80, 0x67, 0x80 | info.length]), info]);
  return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]), segment]);
}
