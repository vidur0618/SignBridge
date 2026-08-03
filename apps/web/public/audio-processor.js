const DEFAULT_TARGET_SAMPLE_RATE = 16_000;
const DEFAULT_FRAME_DURATION_MS = 40;

/**
 * Streaming mono Float32 -> signed 16-bit PCM converter.
 *
 * Resampling uses an area-weighted box filter. Each source sample contributes
 * its exact fractional duration to a target sample. Keeping the phase and
 * weighted sum between calls makes the result independent of AudioWorklet's
 * render-quantum boundaries, including for 44.1 kHz input.
 */
export class Pcm16FrameEncoder {
  constructor({
    sourceSampleRate,
    targetSampleRate = DEFAULT_TARGET_SAMPLE_RATE,
    frameDurationMs = DEFAULT_FRAME_DURATION_MS,
    onFrame,
  }) {
    this.sourceSampleRate = positiveInteger(sourceSampleRate, "sourceSampleRate");
    this.targetSampleRate = positiveInteger(targetSampleRate, "targetSampleRate");
    if (!Number.isFinite(frameDurationMs) || frameDurationMs < 20 || frameDurationMs > 40) {
      throw new RangeError("frameDurationMs must be between 20 and 40 milliseconds");
    }
    if (typeof onFrame !== "function") {
      throw new TypeError("onFrame must be a function");
    }

    this.frameSamples = Math.round((this.targetSampleRate * frameDurationMs) / 1_000);
    this.onFrame = onFrame;
    this.frame = new Int16Array(this.frameSamples);
    this.frameOffset = 0;

    // Time is represented in integer ticks with a denominator of
    // sourceSampleRate * targetSampleRate. A source sample spans
    // targetSampleRate ticks and a target sample spans sourceSampleRate ticks.
    // This avoids cumulative floating-point phase drift.
    this.targetWeight = 0;
    this.weightedSum = 0;
  }

  /** Accept one AudioWorklet input's channels and downmix them to mono. */
  pushChannels(channels) {
    const sampleCount = channels?.[0]?.length ?? 0;
    if (sampleCount === 0) return;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      let channelSum = 0;
      let channelCount = 0;
      for (const channel of channels) {
        const value = channel?.[sampleIndex];
        if (Number.isFinite(value)) {
          channelSum += value;
          channelCount += 1;
        }
      }
      this.pushSourceSample(channelCount > 0 ? channelSum / channelCount : 0);
    }
  }

  pushSourceSample(sample) {
    let sourceWeight = this.targetSampleRate;

    while (sourceWeight > 0) {
      const targetWeightRemaining = this.sourceSampleRate - this.targetWeight;
      const weight = Math.min(sourceWeight, targetWeightRemaining);
      this.weightedSum += sample * weight;
      this.targetWeight += weight;
      sourceWeight -= weight;

      if (this.targetWeight === this.sourceSampleRate) {
        this.pushTargetSample(this.weightedSum / this.sourceSampleRate);
        this.targetWeight = 0;
        this.weightedSum = 0;
      }
    }
  }

  pushTargetSample(sample) {
    const bounded = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    this.frame[this.frameOffset] = bounded < 0
      ? Math.round(bounded * 0x8000)
      : Math.round(bounded * 0x7fff);
    this.frameOffset += 1;

    if (this.frameOffset === this.frameSamples) {
      const completeFrame = this.frame;
      this.frame = new Int16Array(this.frameSamples);
      this.frameOffset = 0;
      this.onFrame(completeFrame.buffer);
    }
  }

  /**
   * Finish the current stream. At most one fractional target sample is emitted,
   * followed by the final short frame. The encoder is then ready for a new
   * independent stream.
   */
  flush() {
    if (this.targetWeight > 0) {
      this.pushTargetSample(this.weightedSum / this.targetWeight);
      this.targetWeight = 0;
      this.weightedSum = 0;
    }

    if (this.frameOffset === 0) return;
    const partialFrame = this.frame.slice(0, this.frameOffset);
    this.frame = new Int16Array(this.frameSamples);
    this.frameOffset = 0;
    this.onFrame(partialFrame.buffer);
  }
}

function positiveInteger(value, name) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

if (typeof AudioWorkletProcessor !== "undefined" && typeof registerProcessor === "function") {
  class SignBridgePcmProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.encoder = new Pcm16FrameEncoder({
        sourceSampleRate: Math.round(sampleRate),
        targetSampleRate: options.processorOptions?.targetSampleRate ?? DEFAULT_TARGET_SAMPLE_RATE,
        frameDurationMs: options.processorOptions?.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS,
        onFrame: (frame) => this.port.postMessage(frame, [frame]),
      });
      this.port.onmessage = (event) => {
        const messageType = typeof event.data === "string" ? event.data : event.data?.type;
        if (messageType !== "flush") return;
        this.encoder.flush();
        this.port.postMessage({
          type: "flushed",
          requestId: typeof event.data === "object" ? event.data?.requestId : undefined,
        });
      };
    }

    process(inputs) {
      this.encoder.pushChannels(inputs[0]);
      return true;
    }
  }

  registerProcessor("signbridge-pcm-processor", SignBridgePcmProcessor);
}
