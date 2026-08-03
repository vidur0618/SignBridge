import { describe, expect, it } from "vitest";
import { DEFAULT_HANDTALK_SDK_URL, loadConfig } from "./config.js";

describe("Hand Talk environment configuration", () => {
  it("uses the pinned SDK URL and HUGO without enabling the provider by default", () => {
    const config = loadConfig({});
    const configWithBlankToken = loadConfig({ HANDTALK_TOKEN: "" });

    expect(config.handtalkToken).toBeUndefined();
    expect(configWithBlankToken.handtalkToken).toBeUndefined();
    expect(config.handtalkSdkUrl).toBe(DEFAULT_HANDTALK_SDK_URL);
    expect(config.handtalkAvatar).toBe("HUGO");
  });

  it("accepts a token, the pinned SDK URL, and the MAYA avatar", () => {
    const config = loadConfig({
      HANDTALK_TOKEN: "configured-token",
      HANDTALK_SDK_URL: DEFAULT_HANDTALK_SDK_URL,
      HANDTALK_AVATAR: "MAYA",
    });

    expect(config.handtalkToken).toBe("configured-token");
    expect(config.handtalkSdkUrl).toBe(DEFAULT_HANDTALK_SDK_URL);
    expect(config.handtalkAvatar).toBe("MAYA");
  });

  it("rejects an unknown avatar or any SDK source other than the pinned official URL", () => {
    expect(() => loadConfig({ HANDTALK_AVATAR: "UNKNOWN" })).toThrow();
    expect(() => loadConfig({ HANDTALK_SDK_URL: "https://assets.example.test/handtalk-sdk.js" })).toThrow();
    expect(() => loadConfig({ HANDTALK_SDK_URL: "http://example.test/sdk.js" })).toThrow();
  });
});
