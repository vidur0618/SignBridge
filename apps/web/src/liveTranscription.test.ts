import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveTranscriptionSocket } from "./liveTranscription.js";

class WebSocketStub {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static latest: WebSocketStub | null = null;

  readonly send = vi.fn();
  readonly close = vi.fn(() => {
    this.readyState = WebSocketStub.CLOSED;
    this.onclose?.({} as CloseEvent);
  });
  readyState = WebSocketStub.CONNECTING;
  binaryType: BinaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    WebSocketStub.latest = this;
  }
}

afterEach(() => {
  WebSocketStub.latest = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LiveTranscriptionSocket", () => {
  it("rejects a pending connection when the utterance is canceled", async () => {
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "127.0.0.1:4173" },
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("WebSocket", WebSocketStub);
    const onConnection = vi.fn();
    const socket = new LiveTranscriptionSocket({
      sessionId: "session-test-1",
      siteId: "site-test-1",
      onEvent: vi.fn(),
      onConnection,
    });

    const connecting = socket.connect();
    socket.close();

    await expect(connecting).rejects.toMatchObject({ name: "AbortError" });
    expect(WebSocketStub.latest?.close).toHaveBeenCalledOnce();
    expect(onConnection).toHaveBeenNthCalledWith(1, "connecting");
    expect(onConnection).toHaveBeenLastCalledWith("idle");
  });

  it("sends the server-owned audio configuration only after open", async () => {
    vi.stubGlobal("window", {
      location: { protocol: "https:", host: "pilot.example" },
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("WebSocket", WebSocketStub);
    const socket = new LiveTranscriptionSocket({
      sessionId: "session-test-2",
      siteId: "site-test-2",
      onEvent: vi.fn(),
      onConnection: vi.fn(),
    });

    const connecting = socket.connect();
    const transport = WebSocketStub.latest;
    expect(transport?.url).toBe("wss://pilot.example/api/live-transcription");
    expect(transport?.send).not.toHaveBeenCalled();
    if (!transport) throw new Error("expected a WebSocket transport");
    transport.readyState = WebSocketStub.OPEN;
    transport.onopen?.({} as Event);
    await connecting;

    const configuration = JSON.parse(String(transport.send.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(configuration).toMatchObject({
      type: "session.configure",
      sessionId: "session-test-2",
      siteId: "site-test-2",
      locale: "en-US",
      retention: "none",
      audio: { encoding: "LINEAR16", sampleRateHertz: 16000, channelCount: 1 },
    });
    socket.close();
  });
});
