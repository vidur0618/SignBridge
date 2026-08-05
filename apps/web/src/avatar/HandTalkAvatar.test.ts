import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AvatarOperationCancelledError,
  AvatarOperationTimeoutError,
  createAvatarOperationCoordinator,
  isPinnedHandTalkSdkUrl,
  loadHandTalkSdk,
  splitAvatarText,
  waitForApplicationState,
  withAvatarOperationTimeout,
} from "./HandTalkAvatar.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

describe("bounded Hand Talk runtime operations", () => {
  it("times out SDK loading, removes the stale script, and retries cleanly", async () => {
    vi.useFakeTimers();

    class FakeScript extends EventTarget {
      src = "";
      async = false;
      removed = false;
      readonly attributes = new Map<string, string>();

      setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
      }

      remove(): void {
        this.removed = true;
        if (currentScript === this) currentScript = null;
      }
    }

    const scripts: FakeScript[] = [];
    let currentScript: FakeScript | null = new FakeScript();
    currentScript.setAttribute("data-signbridge-handtalk-sdk", "true");
    const staleScript = currentScript;
    const documentStub = {
      querySelector: vi.fn(() => currentScript),
      createElement: vi.fn(() => new FakeScript()),
      head: {
        append: vi.fn((script: FakeScript) => {
          currentScript = script;
          scripts.push(script);
        }),
      },
    };
    const windowStub: { HTApi?: unknown } = {};
    vi.stubGlobal("document", documentStub);
    vi.stubGlobal("window", windowStub);

    const url = "https://api-cdn.handtalk.me/sdk/1.0.0/ht-api-sdk.min.js";
    const firstAttempt = loadHandTalkSdk(url, { timeoutMs: 25 });
    const firstFailure = expect(firstAttempt).rejects.toThrow("Check the network");
    await vi.advanceTimersByTimeAsync(25);
    await firstFailure;

    expect(staleScript.removed).toBe(true);
    expect(scripts[0]?.removed).toBe(true);

    const secondAttempt = loadHandTalkSdk(url, { timeoutMs: 25 });
    const missingApiFailure = expect(secondAttempt).rejects.toThrow("without exposing its browser API");
    scripts[1]?.dispatchEvent(new Event("load"));
    await missingApiFailure;
    expect(scripts[1]?.removed).toBe(true);

    const thirdAttempt = loadHandTalkSdk(url, { timeoutMs: 25 });
    windowStub.HTApi = class FakeHandTalkApi {};
    scripts[2]?.dispatchEvent(new Event("load"));

    await expect(thirdAttempt).resolves.toBeUndefined();
    expect(documentStub.createElement).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a provider promise and clears the timeout after rejection", async () => {
    vi.useFakeTimers();
    const pending = withAvatarOperationTimeout(
      new Promise<void>(() => undefined),
      50,
      "Translation timed out; use captions.",
    );
    const failure = expect(pending).rejects.toThrow("Translation timed out; use captions.");

    await vi.advanceTimersByTimeAsync(50);
    await failure;
    const secondPending = withAvatarOperationTimeout(
      new Promise<void>(() => undefined),
      1,
      "Timed out again.",
    );
    const secondFailure = expect(secondPending).rejects.toBeInstanceOf(AvatarOperationTimeoutError);
    await vi.advanceTimersByTimeAsync(1);
    await secondFailure;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a state waiter and immediately removes its listener and timer", async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    const api = {
      getApplicationState: () => "loading",
      onApplicationStateChange: vi.fn(() => unsubscribe),
    } as unknown as Parameters<typeof waitForApplicationState>[0];
    const controller = new AbortController();
    const pending = waitForApplicationState(api, ["ready"], {
      timeoutMs: 5_000,
      signal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(AvatarOperationCancelledError);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("requires a gated post-invocation state event before accepting provider start", async () => {
    vi.useFakeTimers();
    let listener: ((state: string) => void) | undefined;
    let armed = false;
    const api = {
      getApplicationState: () => "translating",
      onApplicationStateChange: vi.fn((callback: (state: string) => void) => {
        listener = callback;
        callback("translating");
        return vi.fn();
      }),
    } as unknown as Parameters<typeof waitForApplicationState>[0];

    const pending = waitForApplicationState(api, ["translating"], {
      acceptCurrent: false,
      eventGate: () => armed,
      timeoutMs: 100,
    });
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    armed = true;
    listener?.("translating");

    await expect(pending).resolves.toBe("translating");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("latest avatar request coordination", () => {
  it("cancels the prior ticket and prevents stale completion from committing", () => {
    const coordinator = createAvatarOperationCoordinator();
    const committed: string[] = [];
    const first = coordinator.begin();
    const second = coordinator.begin();

    expect(first.signal.aborted).toBe(true);
    expect(first.commit(() => committed.push("stale"))).toBe(false);
    expect(second.commit(() => committed.push("latest"))).toBe(true);
    expect(committed).toEqual(["latest"]);

    coordinator.complete(second);
    expect(coordinator.hasCurrent()).toBe(false);
  });

  it("invalidates the active ticket immediately on cancel", () => {
    const coordinator = createAvatarOperationCoordinator();
    const ticket = coordinator.begin();

    coordinator.cancel();

    expect(ticket.signal.aborted).toBe(true);
    expect(ticket.isCurrent()).toBe(false);
    expect(coordinator.hasCurrent()).toBe(false);
  });
});
