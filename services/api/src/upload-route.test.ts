import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpeechProvider } from "./adapters/speech.js";
import { authenticate, makeTestApp } from "./test-helpers.js";

const apps: Array<Awaited<ReturnType<typeof makeTestApp>>["app"]> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("uploaded-audio route limits and fallback mapping", () => {
  it("fails closed before Speech-to-Text when byte-derived duration is unverifiable", async () => {
    const transcribeUpload = vi.fn(async () => []);
    const { app, events } = await makeTestApp({ speech: speechWith(transcribeUpload) });
    apps.push(app);
    const login = await authenticate(app);
    const response = await upload(app, login.cookie, "audio/mpeg", Buffer.from("not an mp3"));

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ fallbackReason: "invalid_audio" });
    expect(transcribeUpload).not.toHaveBeenCalled();
    expect(events.events.filter((event) => event.type === "transcription_completed")).toHaveLength(1);
  });

  it("rejects byte-verified audio over one minute before provider invocation", async () => {
    const transcribeUpload = vi.fn(async () => []);
    const { app, events } = await makeTestApp({ speech: speechWith(transcribeUpload) });
    apps.push(app);
    const login = await authenticate(app);
    const response = await upload(app, login.cookie, "audio/wav", makeWav(480_008));

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ fallbackReason: "audio_too_long" });
    expect(transcribeUpload).not.toHaveBeenCalled();
    expect(events.events.filter((event) => event.fallbackReason === "audio_too_long")).toHaveLength(1);
  });

  it("zeros uploaded bytes and maps long transcript text to captions-only", async () => {
    let providerBuffer: Buffer | undefined;
    const transcribeUpload = vi.fn(async (input: Parameters<SpeechProvider["transcribeUpload"]>[0]) => {
      providerBuffer = input.bytes;
      return [
        {
          id: randomUUID(),
          text: Array.from({ length: 61 }, () => "hello").join(" "),
          isFinal: true,
          startedAtMs: 0,
          endedAtMs: 1_000,
          provider: "google-cloud-speech" as const,
          model: "chirp_3",
        },
      ];
    });
    const { app, events } = await makeTestApp({ speech: speechWith(transcribeUpload) });
    apps.push(app);
    const login = await authenticate(app);
    const response = await upload(app, login.cookie, "audio/wav", makeWav(8_000));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      fallbackReason: "transcript_too_long",
      stableUtterances: [],
      detectedIntents: [],
    });
    expect(providerBuffer).toBeDefined();
    expect(providerBuffer?.every((value) => value === 0)).toBe(true);
    const terminals = events.events.filter((event) => event.type === "transcription_completed");
    expect(terminals).toHaveLength(1);
    expect(terminals[0]?.fallbackReason).toBe("transcript_too_long");
  });

  it("protects the scheduled operations route from unauthenticated callers", async () => {
    const { app } = await makeTestApp();
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/internal/operations/daily" });
    expect(response.statusCode).toBe(401);
  });
});

function speechWith(
  transcribeUpload: SpeechProvider["transcribeUpload"],
): SpeechProvider {
  return {
    providerName: "google-cloud-speech",
    model: "chirp_3",
    transcribeUpload,
    startLive() {
      throw new Error("not used by upload tests");
    },
  };
}

async function upload(
  app: Awaited<ReturnType<typeof makeTestApp>>["app"],
  cookie: string,
  mimeType: string,
  bytes: Buffer,
) {
  const boundary = "signbridge-test-boundary";
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="clip"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return app.inject({
    method: "POST",
    url: "/api/audio/transcribe",
    headers: {
      cookie,
      origin: "http://127.0.0.1:4173",
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([prefix, bytes, suffix]),
  });
}

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
