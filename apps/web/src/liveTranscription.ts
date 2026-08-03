import {
  LiveServerEventSchema,
  type ExperienceMode,
  type LiveSessionConfig,
} from "@signbridge/contracts";
import { normalizeLiveEvent, webSocketUrl } from "./api.js";
import type { LiveCaptionEvent } from "./models.js";

interface SocketOptions {
  sessionId: string;
  siteId: string;
  consentVersion: string;
  outputLane: ExperienceMode;
  onEvent: (event: LiveCaptionEvent) => void;
  onConnection: (state: "idle" | "connecting" | "connected" | "offline") => void;
}

export class LiveTranscriptionSocket {
  private socket: WebSocket | null = null;
  private serverReady = false;
  private intentionallyClosed = false;
  private expectedServerClose = false;
  private connectPromise: Promise<void> | null = null;
  private cancelPendingConnect: (() => void) | null = null;

  constructor(private readonly options: SocketOptions) {}

  connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN && this.serverReady) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.intentionallyClosed = false;
    this.expectedServerClose = false;
    this.serverReady = false;
    this.options.onConnection("connecting");
    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketUrl("/api/live-transcription"));
      let opened = false;
      let settled = false;
      const timeout = window.setTimeout(() => {
        fail(new Error("Live transcription connection timed out."));
        try {
          socket.close();
        } catch {
          // Some engines throw when aborting a socket that has not opened yet.
        }
      }, 10_000);
      const clearAttempt = () => {
        window.clearTimeout(timeout);
        this.connectPromise = null;
        this.cancelPendingConnect = null;
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        clearAttempt();
        resolve();
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearAttempt();
        reject(error);
      };
      this.cancelPendingConnect = () => fail(new DOMException("Speech connection was canceled.", "AbortError"));
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      socket.onopen = () => {
        if (this.intentionallyClosed) {
          socket.close(1000, "session ended");
          fail(new DOMException("Speech connection was canceled.", "AbortError"));
          return;
        }
        opened = true;
        const config: LiveSessionConfig = {
          type: "session.configure",
          sessionId: this.options.sessionId,
          siteId: this.options.siteId,
          locale: "en-US",
          consentVersion: this.options.consentVersion,
          outputLane: this.options.outputLane,
          audio: { encoding: "LINEAR16", sampleRateHertz: 16000, channelCount: 1 },
          retention: "none",
        };
        try {
          socket.send(JSON.stringify(config));
        } catch {
          this.intentionallyClosed = true;
          this.options.onConnection("offline");
          fail(new Error("Could not configure live transcription."));
          try { socket.close(); } catch { /* pending connection already failed */ }
          return;
        }
      };
      socket.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        try {
          const rawEvent = JSON.parse(message.data) as unknown;
          const validated = LiveServerEventSchema.safeParse(rawEvent);
          if (!validated.success) throw new Error("invalid live event");
          const event = normalizeLiveEvent(validated.data);
          if (!this.serverReady) {
            if (event?.type === "ready") {
              this.serverReady = true;
              this.options.onConnection("connected");
              succeed();
              this.options.onEvent(event);
              return;
            }
            if (event?.type === "error") {
              this.options.onConnection("offline");
              fail(new Error(event.message ?? "The speech server rejected this session."));
              return;
            }
            throw new Error("live event arrived before session.ready");
          }
          if (event?.type === "speech_end") this.expectedServerClose = true;
          if (event) this.options.onEvent(event);
        } catch {
          const error = new Error("The speech connection returned an invalid event.");
          if (!this.serverReady) {
            this.options.onConnection("offline");
            fail(error);
            try { socket.close(); } catch { /* pending connection already failed */ }
            return;
          }
          this.options.onEvent({ type: "error", code: "invalid_server_event", message: error.message });
        }
      };
      socket.onerror = () => {
        if (!this.serverReady) fail(new Error("Could not connect to live transcription."));
      };
      socket.onclose = () => {
        const wasReady = this.serverReady;
        this.serverReady = false;
        this.socket = null;
        if (this.intentionallyClosed) {
          if (!opened) fail(new DOMException("Speech connection was canceled.", "AbortError"));
          this.options.onConnection("idle");
          return;
        }
        if (this.expectedServerClose) {
          this.expectedServerClose = false;
          this.options.onConnection("idle");
          return;
        }
        this.options.onConnection("offline");
        if (!wasReady) {
          fail(new Error(opened
            ? "The speech server closed before accepting this session."
            : "Could not connect to live transcription."));
          return;
        }
        this.options.onEvent({
          type: "error",
          code: "connection_lost",
          message: "The speech connection ended. Audio capture stopped; start a new message or use typing.",
        });
      };
    });
    return this.connectPromise;
  }

  sendAudio(frame: ArrayBuffer): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.serverReady) return false;
    try {
      this.socket.send(frame);
      return true;
    } catch {
      try { this.socket.close(); } catch { /* caller handles the failed transport */ }
      return false;
    }
  }

  endUtterance(): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.serverReady) return false;
    try {
      this.socket.send(JSON.stringify({ type: "audio.stop", sessionId: this.options.sessionId }));
      return true;
    } catch {
      try { this.socket.close(); } catch { /* caller handles the failed transport */ }
      return false;
    }
  }

  close(): void {
    this.intentionallyClosed = true;
    this.serverReady = false;
    this.cancelPendingConnect?.();
    try {
      this.socket?.close(1000, "session ended");
    } catch {
      // The pending connect promise was already rejected above.
    }
    this.socket = null;
    this.connectPromise = null;
    this.options.onConnection("idle");
  }
}
