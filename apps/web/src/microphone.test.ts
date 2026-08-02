import { afterEach, describe, expect, it, vi } from "vitest";
import { PcmMicrophone } from "./microphone.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PcmMicrophone", () => {
  it("stops a stream that arrives after microphone setup was canceled", async () => {
    let grantPermission: ((stream: MediaStream) => void) | undefined;
    const pendingPermission = new Promise<MediaStream>((resolve) => {
      grantPermission = resolve;
    });
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    const AudioWorkletNodeStub = class {};
    const contextConstructor = vi.fn();

    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(() => pendingPermission) },
    });
    vi.stubGlobal("window", { AudioWorkletNode: AudioWorkletNodeStub });
    vi.stubGlobal("AudioWorkletNode", AudioWorkletNodeStub);
    vi.stubGlobal("AudioContext", contextConstructor);

    const microphone = new PcmMicrophone();
    const starting = microphone.start(() => undefined);
    await microphone.stop();
    grantPermission?.(stream);

    await expect(starting).rejects.toMatchObject({ name: "AbortError" });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(contextConstructor).not.toHaveBeenCalled();
  });

  it("stops a granted stream when AudioContext construction fails", async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    const AudioWorkletNodeStub = class {};
    class AudioContextStub {
      constructor() {
        throw new Error("AudioContext unavailable");
      }
    }
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.stubGlobal("window", { AudioWorkletNode: AudioWorkletNodeStub });
    vi.stubGlobal("AudioWorkletNode", AudioWorkletNodeStub);
    vi.stubGlobal("AudioContext", AudioContextStub);

    await expect(new PcmMicrophone().start(() => undefined)).rejects.toThrow("AudioContext unavailable");
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it("disconnects the audio graph and closes every track on stop", async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    const disconnectSource = vi.fn(() => { throw new Error("source disconnect failed"); });
    const disconnectWorklet = vi.fn();
    const disconnectGain = vi.fn();
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const source = { connect: vi.fn(), disconnect: disconnectSource };
    const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: disconnectGain };
    let workletInstance: {
      port: { onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null };
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    } | null = null;

    class AudioWorkletNodeStub {
      readonly port = { onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null };
      readonly connect = vi.fn();
      readonly disconnect = disconnectWorklet;

      constructor() {
        workletInstance = this;
      }
    }

    class AudioContextStub {
      readonly audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      readonly destination = {};
      readonly close = closeContext;
      readonly createMediaStreamSource = vi.fn(() => source);
      readonly createGain = vi.fn(() => gain);
    }

    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.stubGlobal("window", { AudioWorkletNode: AudioWorkletNodeStub });
    vi.stubGlobal("AudioWorkletNode", AudioWorkletNodeStub);
    vi.stubGlobal("AudioContext", AudioContextStub);

    const onFrame = vi.fn();
    const microphone = new PcmMicrophone();
    await microphone.start(onFrame);
    const frame = new ArrayBuffer(8);
    const activeWorklet = workletInstance as unknown as {
      port: { onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null };
    };
    activeWorklet.port.onmessage?.({ data: frame } as MessageEvent<ArrayBuffer>);

    expect(onFrame).toHaveBeenCalledWith(frame);
    await microphone.stop();

    expect(activeWorklet.port.onmessage).toBeNull();
    expect(disconnectSource).toHaveBeenCalledOnce();
    expect(disconnectWorklet).toHaveBeenCalledOnce();
    expect(disconnectGain).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(closeContext).toHaveBeenCalledOnce();
  });
});
