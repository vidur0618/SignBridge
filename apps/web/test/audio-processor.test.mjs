import { describe, expect, it } from "vitest";
import { Pcm16FrameEncoder } from "../public/audio-processor.js";

const FRAME_SAMPLES = 640;
const FRAME_BYTES = FRAME_SAMPLES * Int16Array.BYTES_PER_ELEMENT;

function encode({ sourceRate, samples, chunkSizes = [samples.length], flush = true }) {
  const frames = [];
  const encoder = new Pcm16FrameEncoder({
    sourceSampleRate: sourceRate,
    onFrame: (frame) => frames.push(frame.slice(0)),
  });
  let offset = 0;
  let chunkIndex = 0;
  while (offset < samples.length) {
    const requested = chunkSizes[chunkIndex % chunkSizes.length];
    const end = Math.min(samples.length, offset + requested);
    encoder.pushChannels([samples.subarray(offset, end)]);
    offset = end;
    chunkIndex += 1;
  }
  if (flush) encoder.flush();
  return frames;
}

function joinFrames(frames) {
  const sampleCount = frames.reduce((total, frame) => total + frame.byteLength / 2, 0);
  const joined = new Int16Array(sampleCount);
  let offset = 0;
  for (const frame of frames) {
    const samples = new Int16Array(frame);
    joined.set(samples, offset);
    offset += samples.length;
  }
  return joined;
}

describe("Pcm16FrameEncoder", () => {
  it.each([44_100, 48_000])(
    "converts one second at %i Hz to exactly 16 kHz in 40 ms frames",
    (sourceRate) => {
      const input = new Float32Array(sourceRate).fill(0.25);
      const frames = encode({ sourceRate, samples: input, chunkSizes: [128] });

      expect(frames).toHaveLength(25);
      expect(frames.every((frame) => frame.byteLength === FRAME_BYTES)).toBe(true);
      const output = joinFrames(frames);
      expect(output).toHaveLength(16_000);
      expect(output.every((sample) => sample === 8_192)).toBe(true);
    },
  );

  it("preserves sample continuity regardless of render-quantum boundaries", () => {
    const input = Float32Array.from({ length: 11_137 }, (_, index) =>
      Math.sin(index * 0.031) * 0.83 + Math.sin(index * 0.007) * 0.12,
    );
    const contiguous = joinFrames(encode({ sourceRate: 44_100, samples: input }));
    const chunked = joinFrames(encode({
      sourceRate: 44_100,
      samples: input,
      chunkSizes: [1, 127, 128, 17, 255],
    }));

    expect(chunked).toEqual(contiguous);
  });

  it("holds incomplete output until flush and emits one final short frame", () => {
    const input = new Float32Array(4_410).fill(-0.5);
    const frames = encode({ sourceRate: 44_100, samples: input, chunkSizes: [128], flush: false });

    expect(frames.map((frame) => frame.byteLength)).toEqual([FRAME_BYTES, FRAME_BYTES]);

    const flushed = [];
    const encoder = new Pcm16FrameEncoder({
      sourceSampleRate: 44_100,
      onFrame: (frame) => flushed.push(frame.slice(0)),
    });
    encoder.pushChannels([input]);
    encoder.flush();
    encoder.flush();

    expect(flushed.map((frame) => frame.byteLength)).toEqual([
      FRAME_BYTES,
      FRAME_BYTES,
      320 * Int16Array.BYTES_PER_ELEMENT,
    ]);
  });

  it("downmixes channels and clamps PCM samples to the signed 16-bit range", () => {
    const frames = [];
    const encoder = new Pcm16FrameEncoder({
      sourceSampleRate: 16_000,
      onFrame: (frame) => frames.push(frame.slice(0)),
    });
    encoder.pushChannels([
      Float32Array.from([-2, 2, 1, -1]),
      Float32Array.from([-2, 2, 1, -1]),
    ]);
    encoder.flush();

    expect([...joinFrames(frames)]).toEqual([-32_768, 32_767, 32_767, -32_768]);
  });
});
