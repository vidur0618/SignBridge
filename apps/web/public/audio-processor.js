class SignBridgePcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options.processorOptions?.targetSampleRate ?? 16000;
    this.sourceSampleRate = sampleRate;
    this.pending = [];
    this.readPosition = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;

    for (let index = 0; index < channel.length; index += 1) {
      this.pending.push(channel[index]);
    }

    const ratio = this.sourceSampleRate / this.targetSampleRate;
    const output = [];
    while (this.readPosition + ratio <= this.pending.length) {
      const start = Math.floor(this.readPosition);
      const end = Math.min(Math.floor(this.readPosition + ratio), this.pending.length);
      let sum = 0;
      let count = 0;
      for (let index = start; index < end; index += 1) {
        sum += this.pending[index] ?? 0;
        count += 1;
      }
      output.push(count > 0 ? sum / count : 0);
      this.readPosition += ratio;
    }

    const consumed = Math.floor(this.readPosition);
    if (consumed > 0) {
      this.pending.splice(0, consumed);
      this.readPosition -= consumed;
    }

    if (output.length > 0) {
      const pcm = new Int16Array(output.length);
      for (let index = 0; index < output.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, output[index] ?? 0));
        pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("signbridge-pcm-processor", SignBridgePcmProcessor);
