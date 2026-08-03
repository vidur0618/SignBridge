import { describe, expect, it } from "vitest";

import { isPinnedHandTalkSdkUrl, splitAvatarText } from "./HandTalkAvatar.js";

describe("Hand Talk SDK boundary", () => {
  it("accepts only fixed official SDK releases", () => {
    expect(isPinnedHandTalkSdkUrl("https://api-cdn.handtalk.me/sdk/1.0.0/ht-api-sdk.min.js")).toBe(true);
    expect(isPinnedHandTalkSdkUrl("https://api-cdn.handtalk.me/sdk/latest/ht-api-sdk.min.js")).toBe(false);
    expect(isPinnedHandTalkSdkUrl("https://api-cdn.handtalk.me/sdk/beta/ht-api-sdk.min.js")).toBe(false);
  });

  it("rejects lookalike, insecure, and modified URLs", () => {
    expect(isPinnedHandTalkSdkUrl("https://api-cdn.handtalk.me.example/sdk/1.0.0/ht-api-sdk.min.js")).toBe(false);
    expect(isPinnedHandTalkSdkUrl("http://api-cdn.handtalk.me/sdk/1.0.0/ht-api-sdk.min.js")).toBe(false);
    expect(isPinnedHandTalkSdkUrl("https://api-cdn.handtalk.me/sdk/1.0.0/ht-api-sdk.min.js?next=1")).toBe(false);
  });
});

describe("avatar text chunking", () => {
  it("preserves sentence order within the provider limit", () => {
    const text = "First sentence is concise. Second sentence contains more detail. Third sentence closes.";
    const chunks = splitAvatarText(text, 45);

    expect(chunks.every((chunk) => chunk.length <= 45)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });

  it("splits an overlong token without dropping input", () => {
    const chunks = splitAvatarText("abcdefghij", 4);

    expect(chunks).toEqual(["abcd", "efgh", "ij"]);
    expect(chunks.join("")).toBe("abcdefghij");
  });
});
