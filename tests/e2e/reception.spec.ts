import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { join } from "node:path";

async function openDemo(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore local demo" }).click();
  const demoRibbon = page.locator(".demo-ribbon");
  await expect(demoRibbon).toContainText("Local product demo");
  await expect(demoRibbon).toContainText("Scripted transcript and browser-only rules. No Cloud Speech, Gemini, Hand Talk, Firestore, or reviewed ASL assets.");
}

function silentWav(durationSeconds = 0.2): Buffer {
  const sampleRate = 16_000;
  const samples = Math.floor(sampleRate * durationSeconds);
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

const FIXTURE_NOW = "2026-08-01T12:00:00.000Z";
const FIXTURE_FUTURE = "2027-08-01T12:00:00.000Z";

interface ProductionShellOptions {
  publishedGreeting?: boolean;
  avatarEnabled?: boolean;
  onAvatarConfigRequest?: () => void;
}

async function openMockedProduction(
  page: import("@playwright/test").Page,
  options: ProductionShellOptions = {},
): Promise<void> {
  await page.route("**/api/session/exchange", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      accessCode: "pilot-code",
      consentVersion: "v2026-08-02-avatar",
    });
    await route.fulfill({
      json: {
        authenticated: true,
        sessionId: "test-session-1",
        siteId: "test-pilot-site",
        expiresAt: FIXTURE_FUTURE,
      },
    });
  });
  await page.route("**/api/catalog", async (route) => {
    await route.fulfill({
      json: {
        catalogVersion: "test-catalog-v1",
        status: options.publishedGreeting ? "published" : "draft",
        languagePack: "ase-US",
        playbackEnabled: options.publishedGreeting ?? false,
        intents: options.publishedGreeting
          ? [{
              id: "greeting",
              publicDescription: "Welcome a visitor to the front desk.",
              boundary: "A bounded greeting only.",
              available: true,
            }]
          : [],
      },
    });
  });
  await page.route("**/api/avatar/config", async (route) => {
    options.onAvatarConfigRequest?.();
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      json: options.avatarEnabled
        ? {
            provider: "handtalk",
            enabled: true,
            token: "handtalk-e2e-token",
            sdkUrl: "https://api-cdn.handtalk.me/sdk/1.0.0/ht-api-sdk.min.js",
            avatar: "HUGO",
            language: "enUS",
            signLanguage: "en-ase",
            maxCharacters: 1_000,
            status: "experimental",
          }
        : {
            provider: "handtalk",
            enabled: false,
            avatar: "HUGO",
            language: "enUS",
            signLanguage: "en-ase",
            maxCharacters: 1_000,
            status: "experimental",
          },
    });
  });

  await page.goto("/");
  await page.getByLabel("Site access code").fill("pilot-code");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Open reception" }).click();
  await expect(page.getByRole("heading", { name: "Help every visitor feel understood." })).toBeVisible();
  await expect(page.getByText("Local product demo")).toHaveCount(0);
}

async function installMockHandTalkSdk(
  page: import("@playwright/test").Page,
): Promise<{ requestCount: () => number }> {
  let requests = 0;
  await page.route("https://api-cdn.handtalk.me/**", async (route) => {
    requests += 1;
    expect(route.request().url()).toBe("https://api-cdn.handtalk.me/sdk/1.0.0/ht-api-sdk.min.js");
    await route.fulfill({
      contentType: "application/javascript",
      body: `(() => {
        const testWindow = window;
        testWindow.handTalkTranslateCalls = [];
        class MockHandTalkApi {
          constructor(config) {
            this.isLoaded = true;
            this.state = "ready";
            this.listeners = new Set();
            testWindow.handTalkConstructorConfig = config;
          }
          active() { this.state = "ready"; this.emit(); }
          disable() { return Promise.resolve(); }
          translate(sentence) {
            testWindow.handTalkTranslateCalls.push(sentence);
            this.state = "translating";
            this.emit();
            this.state = "ready";
            this.emit();
            return Promise.resolve();
          }
          pause() { this.state = "paused"; this.emit(); }
          resume() { this.state = "translating"; this.emit(); }
          repeat() { return Promise.resolve(); }
          stop() { this.state = "ready"; this.emit(); return Promise.resolve(); }
          maximize() { this.state = "ready"; this.emit(); }
          changeAnimationSpeed() {}
          getApplicationState() { return this.state; }
          onApplicationStateChange(callback) {
            this.listeners.add(callback);
            return () => this.listeners.delete(callback);
          }
          emit() { for (const callback of this.listeners) callback(this.state); }
        }
        testWindow.HTApi = MockHandTalkApi;
      })();`,
    });
  });
  return { requestCount: () => requests };
}

async function installMockLiveCapture(
  page: import("@playwright/test").Page,
  options: { failFirstConnection?: boolean; emitEarlyFinal?: boolean } = {},
): Promise<void> {
  await page.addInitScript((settings) => {
    const testWindow = window as unknown as {
      testSocketConnections: number;
      testSocketConfigs: Array<Record<string, unknown>>;
      stoppedTestTracks: number;
    };
    testWindow.testSocketConnections = 0;
    testWindow.testSocketConfigs = [];
    testWindow.stoppedTestTracks = 0;
    const track = { stop: () => { testWindow.stoppedTestTracks += 1; } };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.resolve({ getTracks: () => [track] } as unknown as MediaStream) },
    });

    class TestAudioWorkletNode {
      readonly port = { onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null };
      connect(): void {}
      disconnect(): void {}
    }
    class TestAudioContext {
      readonly audioWorklet = { addModule: () => Promise.resolve() };
      readonly destination = {};
      createMediaStreamSource(): { connect: () => void; disconnect: () => void } {
        return { connect: () => undefined, disconnect: () => undefined };
      }
      createGain(): { gain: { value: number }; connect: () => void; disconnect: () => void } {
        return { gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined };
      }
      close(): Promise<void> { return Promise.resolve(); }
    }
    Object.defineProperty(window, "AudioWorkletNode", { configurable: true, value: TestAudioWorkletNode });
    Object.defineProperty(window, "AudioContext", { configurable: true, value: TestAudioContext });

    class TestWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readonly connectionNumber: number;
      readyState = TestWebSocket.CONNECTING;
      binaryType: BinaryType = "blob";
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;

      constructor(url?: string | URL) {
        const isSignBridgeSocket = String(url ?? "").includes("/api/live-transcription");
        this.connectionNumber = isSignBridgeSocket ? ++testWindow.testSocketConnections : 0;
        window.setTimeout(() => {
          if (settings.failFirstConnection && this.connectionNumber === 1) {
            this.readyState = TestWebSocket.CLOSED;
            this.onerror?.(new Event("error"));
            this.onclose?.(new CloseEvent("close"));
            return;
          }
          this.readyState = TestWebSocket.OPEN;
          this.onopen?.(new Event("open"));
        }, 0);
      }

      send(data: string | ArrayBuffer): void {
        if (typeof data !== "string") return;
        const message = JSON.parse(data) as {
          type?: string;
          sessionId?: string;
          siteId?: string;
          consentVersion?: string;
        };
        if (message.type === "session.configure") {
          testWindow.testSocketConfigs.push(message);
          window.setTimeout(() => this.emit({
            type: "session.ready",
            session: {
              id: "test-live-audio-session",
              siteId: message.siteId,
              mode: "live",
              locale: "en-US",
              consentVersion: message.consentVersion,
              audio: { encoding: "LINEAR16", sampleRateHertz: 16_000, channelCount: 1 },
              lifecycle: "listening",
              retention: "none",
              createdAt: "2026-08-01T12:00:00.000Z",
            },
          }), 0);
        }
        if (message.type === "session.configure" && settings.failFirstConnection) {
          window.setTimeout(() => this.emit({
            type: "transcript.partial",
            segment: {
              id: "test-live-partial-1",
              sessionId: "test-live-audio-session",
              sequence: 0,
              state: "partial",
              text: "Hello, wel…",
              startMs: 0,
              endMs: 250,
              stability: 0.7,
              provider: "google-cloud-speech-v2",
              model: "test-speech-fixture",
              receivedAt: "2026-08-01T12:00:00.000Z",
            },
          }), 50);
        }
        if (message.type === "session.configure" && settings.emitEarlyFinal) {
          window.setTimeout(() => this.emit({
            type: "transcript.final",
            segment: {
              id: "test-live-segment-1",
              sessionId: "test-live-audio-session",
              sequence: 0,
              state: "final",
              text: "Hello, welcome.",
              startMs: 0,
              endMs: 500,
              confidence: 0.99,
              provider: "google-cloud-speech-v2",
              model: "test-speech-fixture",
              receivedAt: "2026-08-01T12:00:00.000Z",
            },
          }), 50);
        }
        if (message.type === "audio.stop" && settings.emitEarlyFinal) {
          window.setTimeout(() => this.emit({
            type: "fallback",
            sessionId: "test-live-audio-session",
            reasonCode: "out_of_domain",
          }), 0);
        }
      }

      close(): void {
        if (this.readyState === TestWebSocket.CLOSED) return;
        this.readyState = TestWebSocket.CLOSED;
        this.onclose?.(new CloseEvent("close"));
      }

      private emit(payload: unknown): void {
        if (this.readyState !== TestWebSocket.OPEN) return;
        this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
      }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: TestWebSocket });
  }, options);
}

async function installMockMicrophoneOnly(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    const track = { stop: () => undefined };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => Promise.resolve({
          getTracks: () => [track],
        } as unknown as MediaStream),
      },
    });

    class TestAudioWorkletNode {
      readonly port = { onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null };
      connect(): void {}
      disconnect(): void {}
    }
    class TestAudioContext {
      readonly audioWorklet = { addModule: () => Promise.resolve() };
      readonly destination = {};
      createMediaStreamSource(): { connect: () => void; disconnect: () => void } {
        return { connect: () => undefined, disconnect: () => undefined };
      }
      createGain(): { gain: { value: number }; connect: () => void; disconnect: () => void } {
        return { gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined };
      }
      close(): Promise<void> { return Promise.resolve(); }
    }
    Object.defineProperty(window, "AudioWorkletNode", { configurable: true, value: TestAudioWorkletNode });
    Object.defineProperty(window, "AudioContext", { configurable: true, value: TestAudioContext });
  });
}

async function routeReadyLiveSocket(page: import("@playwright/test").Page): Promise<void> {
  await page.routeWebSocket(/\/api\/live-transcription$/, (socket) => {
    socket.onMessage((data) => {
      if (typeof data !== "string") return;
      const message = JSON.parse(data) as {
        type?: string;
        siteId?: string;
        consentVersion?: string;
      };
      if (message.type !== "session.configure") return;
      socket.send(JSON.stringify({
        type: "session.ready",
        session: {
          id: "test-ready-audio-session",
          siteId: message.siteId,
          mode: "live",
          locale: "en-US",
          consentVersion: message.consentVersion,
          audio: { encoding: "LINEAR16", sampleRateHertz: 16_000, channelCount: 1 },
          lifecycle: "listening",
          retention: "none",
          createdAt: "2026-08-01T12:00:00.000Z",
        },
      }));
    });
  });
}

function supportedUploadFixture(): Record<string, unknown> {
  const sessionId = "test-upload-session-1";
  const segmentId = "test-segment-1";
  const utteranceId = "test-utterance-1";
  return {
    outputLane: "asl_captions",
    session: {
      id: sessionId,
      siteId: "test-pilot-site",
      mode: "upload",
      locale: "en-US",
      consentVersion: "v2026-08-02-avatar",
      audio: { encoding: "WAV", sampleRateHertz: 16_000, channelCount: 1 },
      lifecycle: "complete",
      retention: "none",
      createdAt: FIXTURE_NOW,
      endedAt: FIXTURE_NOW,
    },
    segments: [{
      id: segmentId,
      sessionId,
      sequence: 0,
      state: "final",
      text: "Hello, welcome.",
      startMs: 0,
      endMs: 500,
      confidence: 0.99,
      provider: "google-cloud-speech-v2",
      model: "test-speech-fixture",
      receivedAt: FIXTURE_NOW,
    }],
    stableUtterances: [{
      id: utteranceId,
      sessionId,
      segmentIds: [segmentId],
      transcript: "Hello, welcome.",
      isFinal: true,
      finalizationReason: "asr_is_final",
      finalizedAt: FIXTURE_NOW,
    }],
    detectedIntents: [{
      id: "test-detected-intent-1",
      utteranceId,
      status: "supported",
      intentId: "greeting",
      reasonCode: "matched_supported_intent",
      execution: {
        route: "gemini",
        model: "gemini-test-fixture",
        invocationId: "test-invocation-1",
      },
      requiresHumanConfirmation: true,
      classifiedAt: FIXTURE_NOW,
    }],
  };
}

function readyDecisionFixture(): Record<string, unknown> {
  const reviewedSha256 = "0".repeat(64);
  return {
    status: "ready",
    signPlan: {
      id: "test-sign-plan-1",
      utteranceId: "test-utterance-1",
      intentId: "greeting",
      assetId: "test-asset-1",
      catalogVersion: "test-catalog-v1",
      languagePack: "ase-US",
      caption: "Hello, welcome.",
      approvalProvenance: {
        reviewerRef: "reviewer:test-fixture",
        reviewedSha256,
        rightsRef: "rights:test-fixture",
        reviewedAt: FIXTURE_NOW,
      },
      fallbackRule: "captions_only",
      wholeUtterance: true,
      staffConfirmation: "required",
      createdAt: FIXTURE_NOW,
    },
    renderSegment: {
      id: "test-render-1",
      signPlanId: "test-sign-plan-1",
      utteranceId: "test-utterance-1",
      assetId: "test-asset-1",
      caption: "Hello, welcome.",
      videoUrl: "https://media.example.test/asl-test-fixture.mp4",
      urlExpiresAt: FIXTURE_FUTURE,
      playbackRate: 1,
      playbackState: "ready",
      objectFit: "contain",
      mirrored: false,
      captionsVisible: true,
    },
  };
}

test("access gate explains consent, scope, and demo provenance", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Make the first conversation accessible." })).toBeVisible();
  await expect(page.getByText("Automatic avatar output is experimental, may be wrong, and is not certified interpretation. Use qualified support for consequential communication.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open reception" })).toBeDisabled();
  await page.getByLabel("Site access code").fill("pilot-code");
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Open reception" })).toBeEnabled();
  await expect(page.getByText("Clearly labeled caption simulation. No cloud service or avatar provider is called.")).toBeVisible();
});

test("access and reception screens have no serious or critical automated accessibility violations", async ({ page }) => {
  await page.goto("/");
  const captureDirectory = process.env["SIGNBRIDGE_CAPTURE_DIR"];
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "signbridge-access.png"), fullPage: true });
  const accessResults = await new AxeBuilder({ page }).analyze();
  expect(seriousAccessibilityViolations(accessResults.violations)).toEqual([]);

  await page.getByRole("button", { name: "Explore local demo" }).click();
  await expect(page.locator(".demo-ribbon")).toContainText("Scripted transcript and browser-only rules. No Cloud Speech, Gemini, Hand Talk, Firestore, or reviewed ASL assets.");
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "signbridge-reception.png"), fullPage: true });
  const receptionResults = await new AxeBuilder({ page }).analyze();
  expect(seriousAccessibilityViolations(receptionResults.violations)).toEqual([]);
});

test("production mode falls back safely when microphone permission is denied", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => Promise.reject(new DOMException("Microphone permission denied by test fixture.", "NotAllowedError")),
    });
  });
  await routeReadyLiveSocket(page);
  await openMockedProduction(page);

  await page.getByRole("button", { name: "Start microphone" }).click();

  await expect(page.getByRole("heading", { name: "Continue another way" })).toBeVisible();
  await expect(page.getByText("Microphone permission denied by test fixture.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve ASL phrase" })).toHaveCount(0);
  await expect(page.locator("video")).toHaveCount(0);
});

test("browser client and real local API agree on the live-session consent version", async ({ page }) => {
  await installMockMicrophoneOnly(page);
  await page.goto("/");
  await page.getByLabel("Site access code").fill("signbridge-demo");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Open reception" }).click();
  await expect(page.getByRole("heading", { name: "Help every visitor feel understood." })).toBeVisible();

  await page.getByRole("button", { name: "Start microphone" }).click();
  await page.waitForTimeout(300);

  await expect(page.getByRole("button", { name: "Stop & finalize" })).toBeVisible();
  await expect(page.getByText("Speech connected")).toBeVisible();

  await page.getByRole("button", { name: "Stop & finalize" }).click();
  await expect(page.getByRole("heading", { name: "Continue another way" })).toBeVisible();
});

test("production capture retries one pre-audio socket failure and never classifies a partial", async ({ page }) => {
  await installMockLiveCapture(page, { failFirstConnection: true });
  await openMockedProduction(page);

  await page.getByRole("button", { name: "Start microphone" }).click();
  await expect(page.getByRole("button", { name: "Stop & finalize" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { testSocketConnections: number }
  ).testSocketConnections)).toBe(2);
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { testSocketConfigs: Array<Record<string, unknown>> }
  ).testSocketConfigs.map(({ consentVersion }) => consentVersion))).toEqual([
    "v2026-08-02-avatar",
  ]);
  await expect(page.locator(".provisional-caption")).toContainText("Hello, wel…");
  await page.getByRole("button", { name: "Stop & finalize" }).click();

  await expect(page.getByText(/provisional words were discarded/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve ASL phrase" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { stoppedTestTracks: number }
  ).stoppedTestTracks)).toBe(1);
});

test("an early ASR final does not hide Stop or extend push-to-talk capture", async ({ page }) => {
  await installMockLiveCapture(page, { emitEarlyFinal: true });
  await openMockedProduction(page);

  await page.getByRole("button", { name: "Start microphone" }).click();
  await expect(page.locator(".final-caption p")).toHaveText("Hello, welcome.");
  await expect(page.getByRole("button", { name: "Stop & finalize" })).toBeVisible();
  await page.getByRole("button", { name: "Stop & finalize" }).click();

  await expect(page.getByRole("heading", { name: "Continue another way" })).toBeVisible();
  await expect(page.locator(".final-caption p")).toHaveText("Hello, welcome.");
  await expect(page.getByRole("button", { name: "Approve ASL phrase" })).toHaveCount(0);
});

test("canceling delayed microphone permission stops a late-granted stream", async ({ page }) => {
  await routeReadyLiveSocket(page);
  await page.route("**/api/session", async (route) => {
    await route.fulfill({ json: { ended: true } });
  });
  await page.addInitScript(() => {
    const testWindow = window as unknown as {
      grantTestMicrophone: (() => void) | undefined;
      stoppedTestTracks: number;
    };
    testWindow.stoppedTestTracks = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => new Promise<MediaStream>((resolve) => {
        testWindow.grantTestMicrophone = () => resolve({
          getTracks: () => [{ stop: () => { testWindow.stoppedTestTracks += 1; } }],
        } as unknown as MediaStream);
      }),
    });
  });
  await openMockedProduction(page);

  await page.getByRole("button", { name: "Start microphone" }).click();
  await expect(page.getByRole("heading", { name: "Preparing the microphone…" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Make the first conversation accessible." })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { grantTestMicrophone?: () => void }).grantTestMicrophone?.();
  });

  await expect.poll(() => page.evaluate(() => (
    window as unknown as { stoppedTestTracks: number }
  ).stoppedTestTracks)).toBe(1);
  await expect(page.getByRole("button", { name: "Stop & finalize" })).toHaveCount(0);
});

test("production upload service failure retains a safe captions fallback", async ({ page }) => {
  await page.route("**/api/audio/transcribe?*", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("outputLane")).toBe("captions_only");
    await route.fulfill({
      status: 503,
      json: {
        code: "speech_service_error",
        message: "Speech service unavailable in test fixture.",
      },
    });
  });
  await openMockedProduction(page);
  await page.getByRole("button", { name: /Upload/ }).click();
  await page.getByRole("checkbox", { name: /authorized to process this recording/i }).check();
  await page.locator('input[type="file"]').setInputFiles({
    name: "bounded-sample.wav",
    mimeType: "audio/wav",
    buffer: silentWav(),
  });

  await expect(page.getByRole("heading", { name: "Continue another way" })).toBeVisible();
  await expect(page.getByText("Speech service unavailable in test fixture.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve ASL phrase" })).toHaveCount(0);
  await expect(page.locator("video")).toHaveCount(0);
});

test("production playback failure preserves the finalized English caption", async ({ page }) => {
  // These contract-valid route fixtures exercise UI failure handling only. No provider or human review ran.
  await page.route("**/api/audio/transcribe?*", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("outputLane")).toBe("asl_captions");
    await route.fulfill({ json: supportedUploadFixture() });
  });
  await page.route("**/api/utterances/test-utterance-1/decision", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      decision: "play",
      detectedIntentId: "test-detected-intent-1",
    });
    await route.fulfill({ json: readyDecisionFixture() });
  });
  await page.route("**/api/playback-events", async (route) => {
    await route.fulfill({ json: { accepted: true } });
  });
  await page.route("https://media.example.test/**", async (route) => {
    await route.abort("failed");
  });
  await openMockedProduction(page, { publishedGreeting: true });
  await page.getByRole("radio", { name: /Reviewed ASL \+ captions/ }).check();
  await page.getByRole("button", { name: /Upload/ }).click();
  await page.getByRole("checkbox", { name: /authorized to process this recording/i }).check();
  await page.locator('input[type="file"]').setInputFiles({
    name: "bounded-sample.wav",
    mimeType: "audio/wav",
    buffer: silentWav(),
  });
  await expect(page.getByRole("button", { name: "Approve ASL phrase" })).toBeVisible();

  await page.getByRole("button", { name: "Approve ASL phrase" }).click();

  await expect(page.getByText("The signing video could not play. The English caption remains available.")).toBeVisible();
  await expect(page.locator(".final-caption p")).toHaveText("Hello, welcome.");
  await expect(page.locator("video")).toHaveCount(0);
});

test("captions-only default never fetches avatar configuration or SDK code", async ({ page }) => {
  let configRequests = 0;
  let authorizationRequests = 0;
  const sdk = await installMockHandTalkSdk(page);
  await page.route("**/api/avatar/authorize", async (route) => {
    authorizationRequests += 1;
    await route.fulfill({ status: 500, json: { code: "unexpected_avatar_request", message: "Unexpected test request." } });
  });
  await openMockedProduction(page, {
    avatarEnabled: true,
    onAvatarConfigRequest: () => { configRequests += 1; },
  });

  await expect(page.getByRole("radio", { name: /Captions only/ })).toBeChecked();
  await page.getByRole("button", { name: "Type English message" }).click();
  await page.getByLabel("Message for the visitor").fill("Please wait here.");
  await page.getByRole("button", { name: "Show caption" }).click();

  await expect(page.locator(".final-caption p")).toHaveText("Please wait here.");
  expect(configRequests).toBe(0);
  expect(authorizationRequests).toBe(0);
  expect(sdk.requestCount()).toBe(0);
});

test("avatar mode requires activation and per-message confirmation before provider translation", async ({ page }) => {
  let configRequests = 0;
  const authorizationBodies: unknown[] = [];
  const executionBodies: Array<{ authorizationId: string; result: string; latencyMs?: number }> = [];
  const sdk = await installMockHandTalkSdk(page);
  await page.route("**/api/avatar/authorize", async (route) => {
    authorizationBodies.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        allowed: true,
        authorizationId: "avatar-auth-test-1",
        provider: "handtalk",
        text: "The blue umbrella is waiting beside the chair.",
      },
    });
  });
  await page.route("**/api/avatar/events", async (route) => {
    executionBodies.push(route.request().postDataJSON() as { authorizationId: string; result: string; latencyMs?: number });
    await route.fulfill({ json: { accepted: true } });
  });
  await openMockedProduction(page, {
    avatarEnabled: true,
    onAvatarConfigRequest: () => { configRequests += 1; },
  });

  await page.getByRole("radio", { name: /Experimental avatar \+ captions/ }).check();
  const activation = page.getByRole("checkbox", { name: /The visitor chose the experimental avatar/i });
  const enableAvatar = page.getByRole("button", { name: "Enable experimental avatar" });
  await expect(enableAvatar).toBeDisabled();
  expect(configRequests).toBe(0);
  expect(sdk.requestCount()).toBe(0);

  await activation.check();
  await enableAvatar.click();
  await expect(page.getByText("Provider ready. Each message still requires separate confirmation.")).toBeVisible();
  await expect(page.getByText("Experimental ASL avatar ready")).toBeVisible();
  expect(configRequests).toBe(1);
  expect(sdk.requestCount()).toBe(1);

  const message = "The blue umbrella is waiting beside the chair.";
  await page.getByRole("button", { name: "Type English message" }).click();
  await page.getByLabel("Message for the visitor").fill(message);
  await page.getByRole("button", { name: "Prepare avatar & caption" }).click();

  await expect(page.getByRole("heading", { name: "Send this caption to the experimental avatar?" })).toBeVisible();
  await expect(page.locator(".video-caption p")).toHaveText(message);
  expect(authorizationBodies).toHaveLength(0);
  expect(sdk.requestCount()).toBe(1);

  await page.getByRole("button", { name: "Keep captions only" }).click();
  await expect(page.locator(".video-caption p")).toHaveText(message);
  expect(authorizationBodies).toHaveLength(0);
  expect(sdk.requestCount()).toBe(1);

  await page.getByLabel("Message for the visitor").fill(message);
  await page.getByRole("button", { name: "Prepare avatar & caption" }).click();
  await page.getByRole("button", { name: "Confirm avatar message" }).click();

  await expect.poll(() => page.evaluate(() => (
    window as unknown as { handTalkTranslateCalls?: string[] }
  ).handTalkTranslateCalls ?? [])).toEqual([message]);
  expect(authorizationBodies).toEqual([{
    text: message,
    locale: "en-US",
    source: "type",
    staffConfirmed: true,
  }]);
  expect(sdk.requestCount()).toBe(1);
  await expect.poll(() => executionBodies.map(({ result }) => result)).toEqual(["started", "completed"]);
  for (const event of executionBodies) {
    expect(event.authorizationId).toBe("avatar-auth-test-1");
    expect(event.latencyMs).toBeGreaterThanOrEqual(0);
    expect(event.latencyMs).toBeLessThanOrEqual(120_000);
  }
  await expect(page.locator(".video-caption p")).toHaveText(message);
  await expect(page.getByText("English caption · final")).toBeVisible();
  await expect(page.getByText(/Staff confirmed this message/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByLabel("Avatar speed")).toHaveValue("normal");
  await expect(page.getByLabel("Avatar speed").locator("option")).toHaveText(["Slow", "Standard", "Fast"]);
});

test("demo speech flow marks provisional text and blocks fake ASL playback", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("radio", { name: /Reviewed ASL \+ captions/ }).check();

  await page.getByRole("button", { name: "Start microphone" }).click();
  await expect(page.getByRole("button", { name: "Stop & finalize" })).toBeVisible();
  await page.waitForTimeout(550);
  const provisional = page.locator(".provisional-caption");
  await expect(provisional).toContainText("Provisional");
  await expect(provisional).toHaveAttribute("aria-hidden", "true");

  await page.getByRole("button", { name: "Stop & finalize" }).click();
  await expect(page.getByText("English caption · final")).toBeVisible();
  await expect(page.getByText("Does this phrase match your meaning?")).toBeVisible();
  await page.getByRole("button", { name: "Approve ASL phrase" }).click();

  await expect(page.getByText(/Demo boundary reached/i)).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.getByText(/No Cloud Speech, Gemini, Hand Talk, Firestore, or reviewed ASL assets/i)).toBeVisible();
});

test("high-stakes typed content takes the safe fallback", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Type English message" }).click();
  await page.getByLabel("Message for the visitor").fill("This is a medical emergency and we need a doctor.");
  await page.getByRole("button", { name: "Show caption" }).click();

  await expect(page.getByRole("heading", { name: "Continue another way" })).toBeVisible();
  await expect(page.locator(".fallback-card").getByText(
    "This may be consequential communication. Use a qualified interpreter or appropriate support.",
  )).toBeVisible();
  await expect(page.locator(".final-caption p")).toHaveText("This is a medical emergency and we need a doctor.");
});

test("captions-only mode never offers ASL approval", async ({ page }) => {
  await openDemo(page);
  await expect(page.getByRole("radio", { name: /Captions only/ })).toBeChecked();
  await page.getByRole("button", { name: "Type English message" }).click();
  await page.getByLabel("Message for the visitor").fill("Please wait here.");
  await page.getByRole("button", { name: "Show caption" }).click();

  await expect(page.getByText("The final caption is ready. No phrase classifier or signing provider was invoked.")).toBeVisible();
  await expect(page.getByText("Caption ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve ASL phrase" })).toHaveCount(0);
});

test("captions-only typed text does not run the reception intent classifier", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Type English message" }).click();
  await page.getByLabel("Message for the visitor").fill("The quarterly board packet is on the printer.");
  await page.getByRole("button", { name: "Show caption" }).click();

  await expect(page.getByText("The final caption is ready. No phrase classifier or signing provider was invoked.")).toBeVisible();
  await expect(page.getByText(/outside the ten reception phrases/i)).toHaveCount(0);
  await expect(page.locator(".final-caption p")).toHaveText("The quarterly board packet is on the printer.");
});

test("sign-out clears typed visitor text before the next session", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Type English message" }).click();
  await page.getByLabel("Message for the visitor").fill("Private visitor message");
  await page.getByRole("button", { name: "Sign out" }).click();

  await page.getByRole("button", { name: "Explore local demo" }).click();
  await page.getByRole("button", { name: "Type English message" }).click();
  await expect(page.getByLabel("Message for the visitor")).toHaveValue("");
});

test("switching to captions only withdraws an already displayed approval choice", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("radio", { name: /Reviewed ASL \+ captions/ }).check();
  await page.getByRole("button", { name: "Type English message" }).click();
  await page.getByLabel("Message for the visitor").fill("Hello, welcome.");
  await page.getByRole("button", { name: "Show caption" }).click();
  await expect(page.getByRole("button", { name: "Approve ASL phrase" })).toBeVisible();

  await page.getByRole("radio", { name: /Captions only/ }).check();

  await expect(page.getByRole("button", { name: "Approve ASL phrase" })).toHaveCount(0);
  await expect(page.getByText(/Captions-only mode is active/i)).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
});

test("demo upload validates a small WAV locally without claiming transcription", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("radio", { name: /Reviewed ASL \+ captions/ }).check();
  await page.getByRole("button", { name: /Upload/ }).click();
  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toBeDisabled();
  const uploadAuthorization = page.getByRole("checkbox", { name: /authorized to process this recording/i });
  await uploadAuthorization.check();
  await expect(fileInput).toBeEnabled();
  await fileInput.setInputFiles({
    name: "bounded-sample.wav",
    mimeType: "audio/wav",
    buffer: silentWav(),
  });

  await expect(page.getByText(/validated in your browser but its audio was not transcribed or uploaded/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Does this phrase match your meaning?" })).toBeVisible();
  await expect(page.getByText("Please wait here.")).toBeVisible();
  await expect(uploadAuthorization).not.toBeChecked();
  await expect(fileInput).toBeDisabled();
});

test("staff can reject a supported candidate and retain the caption", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("radio", { name: /Reviewed ASL \+ captions/ }).check();
  await page.getByRole("button", { name: "Type English message" }).click();
  await page.getByLabel("Message for the visitor").fill("Hello, welcome.");
  await page.getByRole("button", { name: "Show caption" }).click();
  await page.getByRole("button", { name: "Use captions only" }).click();

  await expect(page.getByRole("heading", { name: "Continue another way" })).toBeVisible();
  await expect(page.locator(".final-caption p")).toHaveText("Hello, welcome.");
  await expect(page.locator("video")).toHaveCount(0);
});

test("core demo path is operable from the keyboard", async ({ page }) => {
  await page.goto("/");
  const demoButton = page.getByRole("button", { name: "Explore local demo" });
  await demoButton.focus();
  await page.keyboard.press("Enter");

  const reviewedMode = page.getByRole("radio", { name: /Reviewed ASL \+ captions/ });
  await reviewedMode.focus();
  await page.keyboard.press("Space");

  const typeTab = page.getByRole("button", { name: "Type English message" });
  await typeTab.focus();
  await page.keyboard.press("Enter");
  const message = page.getByLabel("Message for the visitor");
  await message.focus();
  await page.keyboard.type("How can I help you?");
  const submit = page.getByRole("button", { name: "Show caption" });
  await submit.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Does this phrase match your meaning?" })).toBeVisible();
  await expect(submit).not.toBeFocused();
});

test("illustrative metrics are labeled and expose no transcript content", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Pilot metrics" }).click();

  await expect(page.getByRole("heading", { name: "What is working at reception" })).toBeVisible();
  await expect(page.getByText("Illustrative metrics")).toBeVisible();
  await expect(page.getByText(/static UI samples—not observed customer activity/i)).toBeVisible();
  await expect(page.getByText(/No audio or transcript content/i)).toBeVisible();
});

test("reflows at 320 CSS pixels without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await openDemo(page);

  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  await expect(page.getByRole("heading", { name: "Conversation" })).toBeVisible();
});

test("retains reflow at a 200 percent zoom-equivalent width", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await openDemo(page);

  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  await expect(page.getByRole("heading", { name: "Help every visitor feel understood." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conversation" })).toBeVisible();
});

test("forced colors and reduced motion retain usable controls", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await openDemo(page);

  await expect(page.getByRole("button", { name: "Start microphone" })).toBeVisible();
  await expect(page.getByText("Signing is always opt-in")).toBeVisible();
  const mediaStyles = await page.evaluate(() => ({
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    animationDuration: getComputedStyle(document.querySelector(".status-dot") as Element).animationDuration,
  }));
  expect(mediaStyles.scrollBehavior).toBe("auto");
  const animationSeconds = mediaStyles.animationDuration.endsWith("ms")
    ? Number.parseFloat(mediaStyles.animationDuration) / 1000
    : Number.parseFloat(mediaStyles.animationDuration);
  expect(animationSeconds).toBeLessThanOrEqual(0.000001);
});

function seriousAccessibilityViolations(
  violations: Array<{
    id: string;
    impact?: string | null;
    nodes: Array<{ target?: unknown; failureSummary?: string }>;
  }>,
): Array<{
  id: string;
  impact?: string | null;
  nodes: Array<{ target?: unknown; failureSummary?: string }>;
}> {
  return violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        failureSummary: node.failureSummary,
      })),
    }));
}
