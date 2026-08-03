import { v2 } from "@google-cloud/speech";
import { describe, expect, it, vi } from "vitest";
import { testConfig } from "../config.js";
import {
  GoogleSpeechProvider,
  speechApiEndpointForLocation,
} from "./speech.js";

describe("GoogleSpeechProvider regional routing", () => {
  it("maps multi-regions and regions to matching Speech-to-Text endpoints", () => {
    expect(speechApiEndpointForLocation("us")).toBe("us-speech.googleapis.com");
    expect(speechApiEndpointForLocation("eu")).toBe("eu-speech.googleapis.com");
    expect(speechApiEndpointForLocation("us-central1")).toBe(
      "us-central1-speech.googleapis.com",
    );
    expect(speechApiEndpointForLocation("global")).toBe("speech.googleapis.com");
    expect(() => speechApiEndpointForLocation("https://example.test")).toThrow(
      /Invalid Google Speech-to-Text location/,
    );
  });

  it("fails closed when an AppConfig bypasses schema validation with global chirp_3", () => {
    const fakeClient = {} as v2.SpeechClient;

    expect(
      () =>
        new GoogleSpeechProvider(
          testConfig({
            googleCloudProject: "speech-project",
            googleSpeechLocation: "global",
            googleSpeechModel: "chirp_3",
          }),
          fakeClient,
        ),
    ).toThrow(/chirp_3 requires a currently supported GA location/);
  });

  it("uses the regional recognizer path while preserving an injected client", async () => {
    const recognize = vi.fn(async (_request: unknown) => [{ results: [] }]);
    const fakeClient = { recognize } as unknown as v2.SpeechClient;
    const provider = new GoogleSpeechProvider(
      testConfig({
        googleCloudProject: "speech-project",
        googleSpeechLocation: "eu",
        googleSpeechRecognizer: "reception",
        googleSpeechModel: "chirp_3",
      }),
      fakeClient,
    );

    await provider.transcribeUpload({
      bytes: Buffer.from("test-audio"),
      mimeType: "audio/wav",
      locale: "en-US",
    });

    expect(provider.apiEndpoint).toBe("eu-speech.googleapis.com");
    expect(recognize).toHaveBeenCalledOnce();
    expect(recognize.mock.calls[0]?.[0]).toMatchObject({
      recognizer: "projects/speech-project/locations/eu/recognizers/reception",
      config: {
        languageCodes: ["en-US"],
        model: "chirp_3",
      },
    });
  });
});
