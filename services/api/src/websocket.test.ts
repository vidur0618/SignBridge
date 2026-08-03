import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveServerEvent } from "@signbridge/contracts";
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
      consentVersion: "2026-08-01.1",
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
});
