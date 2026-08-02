export interface MicrophoneState {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  worklet: AudioWorkletNode;
  silentGain: GainNode;
}

export class PcmMicrophone {
  private state: MicrophoneState | null = null;
  private generation = 0;

  async start(onFrame: (frame: ArrayBuffer) => void, onOpened?: () => void): Promise<void> {
    if (this.state) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is not supported in this browser.");
    }
    if (!window.AudioWorkletNode) {
      throw new Error("This browser does not support the required audio capture feature.");
    }

    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (generation !== this.generation) {
      for (const track of stream.getTracks()) track.stop();
      throw microphoneSetupCanceled();
    }
    let context: AudioContext | null = null;

    try {
      onOpened?.();
      context = new AudioContext({ latencyHint: "interactive" });
      await context.audioWorklet.addModule("/audio-processor.js");
      if (generation !== this.generation) throw microphoneSetupCanceled();
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "signbridge-pcm-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        processorOptions: { targetSampleRate: 16000 },
      });
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (generation === this.generation) onFrame(event.data);
      };
      source.connect(worklet);
      worklet.connect(silentGain);
      silentGain.connect(context.destination);
      if (generation !== this.generation) {
        worklet.port.onmessage = null;
        source.disconnect();
        worklet.disconnect();
        silentGain.disconnect();
        throw microphoneSetupCanceled();
      }
      this.state = { stream, context, source, worklet, silentGain };
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      await context?.close().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.generation += 1;
    const current = this.state;
    this.state = null;
    if (!current) return;
    for (const track of current.stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Continue closing every track and audio node.
      }
    }
    try { current.worklet.port.onmessage = null; } catch { /* best-effort cleanup */ }
    try { current.source.disconnect(); } catch { /* best-effort cleanup */ }
    try { current.worklet.disconnect(); } catch { /* best-effort cleanup */ }
    try { current.silentGain.disconnect(); } catch { /* best-effort cleanup */ }
    await current.context.close().catch(() => undefined);
  }
}

function microphoneSetupCanceled(): DOMException {
  return new DOMException("Microphone setup was canceled.", "AbortError");
}
