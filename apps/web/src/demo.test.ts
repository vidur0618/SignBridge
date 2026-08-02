import { describe, expect, it } from "vitest";
import { classifyDemoTranscript, DEMO_CATALOG, validateAudioFile } from "./demo.js";

describe("local demo classifier", () => {
  it("matches only a bounded reception intent", () => {
    const result = classifyDemoTranscript("Please wait here.");

    expect(result).toMatchObject({
      supported: true,
      intentId: "ask_wait",
      reasonCode: "demo_rule_match",
      requiresHumanConfirmation: true,
    });
    expect(result.model).toBeUndefined();
    expect(result.invocationId).toBeUndefined();
  });

  it("blocks high-stakes content before any supported rule", () => {
    const result = classifyDemoTranscript("Please wait here for the doctor in this medical emergency.");

    expect(result.supported).toBe(false);
    expect(result.reasonCode).toBe("high_stakes_content");
    expect(result.intentId).toBeUndefined();
  });

  it("rejects a safe keyword embedded in a high-stakes composite", () => {
    const result = classifyDemoTranscript("Hello, I have a gun.");

    expect(result.supported).toBe(false);
    expect(result.reasonCode).toBe("high_stakes_content");
  });

  it("uses the same bounded-domain gate as production", () => {
    const result = classifyDemoTranscript("Hello, welcome. How may I help you today?");

    expect(result.supported).toBe(false);
    expect(result.reasonCode).toBe("out_of_domain");
  });

  it("falls back for content outside the ten demo phrases", () => {
    const result = classifyDemoTranscript("The quarterly board packet is on the printer.");

    expect(result.supported).toBe(false);
    expect(result.reasonCode).toBe("out_of_domain");
  });

  it("contains exactly the ten launch intents", () => {
    expect(DEMO_CATALOG.intents).toHaveLength(10);
    expect(new Set(DEMO_CATALOG.intents.map((intent) => intent.id)).size).toBe(10);
  });
});

describe("audio file validation", () => {
  it("accepts bounded audio formats", () => {
    expect(validateAudioFile({ name: "reception.webm", size: 512_000, type: "audio/webm" })).toBeNull();
    expect(validateAudioFile({ name: "reception.mp3", size: 512_000, type: "audio/mpeg" })).toBeNull();
  });

  it("rejects unsupported and oversized files", () => {
    expect(validateAudioFile({ name: "notes.txt", size: 200, type: "text/plain" })).toContain("WAV, MP3, or WebM");
    expect(validateAudioFile({ name: "long.wav", size: 10 * 1024 * 1024 + 1, type: "audio/wav" })).toContain("smaller than 10 MB");
  });
});
