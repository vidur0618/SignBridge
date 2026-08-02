import { randomUUID } from "node:crypto";
import { v2, protos } from "@google-cloud/speech";
import type { AppConfig } from "../config.js";
import type { SpeechSegment } from "../domain.js";

export interface UploadTranscriptionInput {
  bytes: Buffer;
  mimeType: "audio/wav" | "audio/mpeg" | "audio/webm";
  locale: "en-US";
}

export interface LiveSpeechCallbacks {
  onSegment: (segment: SpeechSegment) => void;
  onSpeechEnd: () => void;
  onError: (error: Error) => void;
}

export interface LiveSpeechConnection {
  write: (audio: Buffer) => void;
  stop: () => void;
  destroy: () => void;
}

export interface SpeechProvider {
  readonly providerName: "google-cloud-speech" | "local-demo";
  readonly model: string;
  transcribeUpload(input: UploadTranscriptionInput): Promise<readonly SpeechSegment[]>;
  startLive(locale: "en-US", callbacks: LiveSpeechCallbacks): LiveSpeechConnection;
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export class LocalUnavailableSpeechProvider implements SpeechProvider {
  readonly providerName = "local-demo" as const;
  readonly model = "none";

  async transcribeUpload(_input: UploadTranscriptionInput): Promise<readonly SpeechSegment[]> {
    throw new ProviderUnavailableError(
      "Speech transcription is disabled in local mode. Use typed captions or manual phrase selection.",
    );
  }

  startLive(_locale: "en-US", callbacks: LiveSpeechCallbacks): LiveSpeechConnection {
    let closed = false;
    return {
      write: () => undefined,
      stop: () => {
        if (closed) return;
        closed = true;
        callbacks.onError(
          new ProviderUnavailableError(
            "Speech transcription is disabled in local mode. Use typed captions or manual phrase selection.",
          ),
        );
      },
      destroy: () => {
        closed = true;
      },
    };
  }
}

type StreamingResponse = protos.google.cloud.speech.v2.IStreamingRecognizeResponse;

function secondsToNumber(value: number | string | { toNumber(): number } | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value.toNumber === "function") return value.toNumber();
  return 0;
}

function resultEndMs(
  value: protos.google.protobuf.IDuration | null | undefined,
): number {
  if (!value) return 0;
  return secondsToNumber(value.seconds) * 1_000 + Math.round((value.nanos ?? 0) / 1_000_000);
}

function mapStreamingResults(
  response: StreamingResponse,
  provider: GoogleSpeechProvider,
): readonly SpeechSegment[] {
  return (response.results ?? []).flatMap((result) => {
    const text = result.alternatives?.[0]?.transcript?.trim();
    if (!text) return [];
    const endedAtMs = resultEndMs(result.resultEndOffset);
    const segment: SpeechSegment = {
      id: randomUUID(),
      text,
      isFinal: result.isFinal ?? false,
      startedAtMs: 0,
      endedAtMs,
      provider: provider.providerName,
      model: provider.model,
      ...(result.alternatives?.[0]?.confidence != null
        ? { confidence: result.alternatives[0].confidence }
        : {}),
      ...(result.stability != null ? { stability: result.stability } : {}),
    };
    return [segment];
  });
}

export class GoogleSpeechProvider implements SpeechProvider {
  readonly providerName = "google-cloud-speech" as const;
  readonly model: string;
  readonly #client: v2.SpeechClient;
  readonly #recognizer: string;

  constructor(config: AppConfig, client = new v2.SpeechClient()) {
    if (!config.googleCloudProject) {
      throw new Error("GOOGLE_CLOUD_PROJECT is required for Google Speech-to-Text");
    }
    this.model = config.googleSpeechModel;
    this.#client = client;
    this.#recognizer = `projects/${config.googleCloudProject}/locations/${config.googleSpeechLocation}/recognizers/${config.googleSpeechRecognizer}`;
  }

  async transcribeUpload(input: UploadTranscriptionInput): Promise<readonly SpeechSegment[]> {
    const startedAt = Date.now();
    const [response] = await this.#client.recognize({
      recognizer: this.#recognizer,
      config: {
        autoDecodingConfig: {},
        languageCodes: [input.locale],
        model: this.model,
        features: { enableAutomaticPunctuation: true },
      },
      content: input.bytes,
    });

    let previousEndMs = 0;
    return (response.results ?? []).flatMap((result) => {
      const text = result.alternatives?.[0]?.transcript?.trim();
      if (!text) return [];
      const endedAtMs = resultEndMs(result.resultEndOffset);
      const segment: SpeechSegment = {
        id: randomUUID(),
        text,
        isFinal: true,
        startedAtMs: previousEndMs,
        endedAtMs: endedAtMs || Date.now() - startedAt,
        provider: this.providerName,
        model: this.model,
        ...(result.alternatives?.[0]?.confidence != null
          ? { confidence: result.alternatives[0].confidence }
          : {}),
      };
      previousEndMs = segment.endedAtMs;
      return [segment];
    });
  }

  startLive(locale: "en-US", callbacks: LiveSpeechCallbacks): LiveSpeechConnection {
    const stream = this.#client._streamingRecognize();
    let closed = false;
    stream.on("data", (response: StreamingResponse) => {
      for (const segment of mapStreamingResults(response, this)) callbacks.onSegment(segment);
      if (response.speechEventType === "END_OF_SINGLE_UTTERANCE") callbacks.onSpeechEnd();
    });
    stream.on("error", (error: Error) => {
      if (!closed) callbacks.onError(error);
    });
    stream.on("end", callbacks.onSpeechEnd);
    stream.write({
      recognizer: this.#recognizer,
      streamingConfig: {
        config: {
          explicitDecodingConfig: {
            encoding: "LINEAR16",
            sampleRateHertz: 16_000,
            audioChannelCount: 1,
          },
          languageCodes: [locale],
          model: this.model,
          features: { enableAutomaticPunctuation: true },
        },
        streamingFeatures: {
          interimResults: true,
          enableVoiceActivityEvents: true,
        },
      },
    });

    return {
      write: (audio) => {
        if (!closed) stream.write({ audio });
      },
      stop: () => {
        if (closed) return;
        closed = true;
        stream.end();
      },
      destroy: () => {
        if (closed) return;
        closed = true;
        stream.destroy();
      },
    };
  }
}
