import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_CONSENT_VERSION } from "@signbridge/contracts";
import type { ExperienceMode, LiveServerEvent } from "@signbridge/contracts";
import type { LiveSpeechCallbacks, SpeechProvider } from "./adapters/speech.js";
import { authenticate, makeTestApp, supportedClassifier } from "./test-helpers.js";

const apps: Array<Awaited<ReturnType<typeof makeTestApp>>["app"]> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("live transcription with the Hand Talk provider configured", () => {
  it("still runs the reviewed-intent classifier for finalized speech", async () => {
    const classifier = supportedClassifier();
    const classify = vi.spyOn(classifier, "classify");
    let callbacks: LiveSpeechCallbacks | undefined;
    const speech: SpeechProvider = {
      providerName: "google-cloud-speech",
      model: "chirp_3",
      async transcribeUpload() {
        return [];
      },
      startLive(_locale, nextCallbacks) {
        callbacks = nextCallbacks;
        return {
          write() {},
          stop() {
            nextCallbacks.onSegment({
              id: randomUUID(),
              text: "Welcome",
              isFinal: true,
              startedAtMs: 0,
              endedAtMs: 900,
              provider: "google-cloud-speech",
              model: "chirp_3",
            });
            nextCallbacks.onSpeechEnd();
          },
          destroy() {},
        };
      },
    };
    const { app } = await makeTestApp({
      config: { handtalkToken: "configured-handtalk-token" },
      classifier,
      speech,
    });
    apps.push(app);
    const login = await authenticate(app);
    await app.ready();
    const socket = await app.injectWS("/api/live-transcription", {
      headers: {
        cookie: login.cookie,
        origin: "http://127.0.0.1:4173",
      },
    });
    const events: LiveServerEvent[] = [];
    const complete = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for speech_end")), 2_000);
      socket.on("message", (bytes) => {
        const event = JSON.parse(bytes.toString()) as LiveServerEvent;
        events.push(event);
        if (event.type === "session.ready") {
          socket.send(JSON.stringify({ type: "audio.stop", sessionId: login.sessionId }));
        }
        if (event.type === "speech_end") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    socket.send(JSON.stringify({
      type: "session.configure",
      sessionId: login.sessionId,
      siteId: "test-site",
      locale: "en-US",
      consentVersion: CURRENT_CONSENT_VERSION,
      outputLane: "asl_captions",
      audio: { encoding: "LINEAR16", sampleRateHertz: 16_000, channelCount: 1 },
      retention: "none",
    }));

    try {
      await complete;
      expect(callbacks).toBeDefined();
      expect(classify).toHaveBeenCalledOnce();
      expect(classify).toHaveBeenCalledWith("Welcome");
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "intent.candidate",
          utterance: expect.objectContaining({ transcript: "Welcome" }),
          detectedIntent: expect.objectContaining({ status: "supported", intentId: "greeting" }),
        }),
      ]));
    } finally {
      socket.terminate();
    }
  });

  it.each(["captions_only", "avatar_captions"] as const)(
    "keeps final speech in the %s lane without invoking the reviewed-phrase classifier",
    async (outputLane) => {
      const classifier = supportedClassifier();
      const classify = vi.spyOn(classifier, "classify");
      const { app, events } = await makeTestApp({
        classifier,
        speech: welcomeLiveSpeech(),
      });
      apps.push(app);
      const login = await authenticate(app);

      const received = await runLiveSession(app, login, outputLane);

      expect(classify).not.toHaveBeenCalled();
      expect(received).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "transcript.final",
          segment: expect.objectContaining({ text: "Welcome", state: "final" }),
        }),
        expect.objectContaining({ type: "speech_end" }),
      ]));
      expect(received.some((event) => event.type === "intent.candidate")).toBe(false);
      expect(received.some((event) => event.type === "fallback")).toBe(false);
      expect(events.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "transcription_completed",
          flow: "live",
          outputLane,
          speechProvider: "google-cloud-speech",
          speechModel: "chirp_3",
        }),
      ]));
      const terminal = events.events.find((event) => event.type === "transcription_completed");
      expect(terminal?.classifierProvider).toBeUndefined();
      expect(terminal?.classifierModel).toBeUndefined();
      expect(terminal?.classifierInvocationId).toBeUndefined();
      expect(terminal?.fallbackReason).toBeUndefined();
    },
  );
});

function welcomeLiveSpeech(): SpeechProvider {
  return {
    providerName: "google-cloud-speech",
    model: "chirp_3",
    async transcribeUpload() {
      return [];
    },
    startLive(_locale, callbacks) {
      return {
        write() {},
        stop() {
          callbacks.onSegment({
            id: randomUUID(),
            text: "Welcome",
            isFinal: true,
            startedAtMs: 0,
            endedAtMs: 900,
            provider: "google-cloud-speech",
            model: "chirp_3",
          });
          callbacks.onSpeechEnd();
        },
        destroy() {},
      };
    },
  };
}

async function runLiveSession(
  app: Awaited<ReturnType<typeof makeTestApp>>["app"],
  login: { cookie: string; sessionId: string },
  outputLane: ExperienceMode,
): Promise<LiveServerEvent[]> {
  await app.ready();
  const socket = await app.injectWS("/api/live-transcription", {
    headers: {
      cookie: login.cookie,
      origin: "http://127.0.0.1:4173",
    },
  });
  const received: LiveServerEvent[] = [];
  const complete = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for speech_end")), 2_000);
    socket.on("message", (bytes) => {
      const event = JSON.parse(bytes.toString()) as LiveServerEvent;
      received.push(event);
      if (event.type === "session.ready") {
        socket.send(JSON.stringify({ type: "audio.stop", sessionId: login.sessionId }));
      }
      if (event.type === "speech_end") {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  socket.send(JSON.stringify({
    type: "session.configure",
    sessionId: login.sessionId,
    siteId: "test-site",
    locale: "en-US",
    consentVersion: CURRENT_CONSENT_VERSION,
    outputLane,
    audio: { encoding: "LINEAR16", sampleRateHertz: 16_000, channelCount: 1 },
    retention: "none",
  }));
  try {
    await complete;
    return received;
  } finally {
    socket.terminate();
  }
}
