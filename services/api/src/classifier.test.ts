import type { GoogleAuth } from "google-auth-library";
import { describe, expect, it, vi } from "vitest";
import { GeminiClassifier } from "./adapters/classifier.js";
import { testConfig } from "./config.js";

describe("Gemini 3.6 structured classifier request", () => {
  it("omits deprecated sampling parameters and selects a non-thought text part", async () => {
    const request = vi.fn(async () => ({
      data: {
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: "internal reasoning" },
                { thoughtSignature: "opaque-signature" },
                { text: "{\"intentId\":" },
                { text: "\"greeting\"}" },
              ],
            },
          },
        ],
      },
    }));
    const auth = {
      async getClient() {
        return { request };
      },
    } as unknown as GoogleAuth;
    const classifier = new GeminiClassifier(
      testConfig({
        useGoogleCloud: true,
        googleCloudProject: "test-project",
      }),
      auth,
    );

    await expect(classifier.classify("Welcome")).resolves.toMatchObject({
      state: "supported",
      intentId: "greeting",
      model: "gemini-3.6-flash",
    });
    const requestPayload = request.mock.calls[0]?.[0] as {
      data?: { generationConfig?: Record<string, unknown> };
    };
    expect(requestPayload.data?.generationConfig).toMatchObject({
      responseMimeType: "application/json",
    });
    expect(requestPayload.data?.generationConfig).not.toHaveProperty("temperature");
    expect(requestPayload.data?.generationConfig).not.toHaveProperty("topP");
    expect(requestPayload.data?.generationConfig).not.toHaveProperty("topK");
    expect(requestPayload.data?.generationConfig).not.toHaveProperty("top_p");
    expect(requestPayload.data?.generationConfig).not.toHaveProperty("top_k");
  });
});
