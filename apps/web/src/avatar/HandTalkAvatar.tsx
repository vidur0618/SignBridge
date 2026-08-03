import {
  type ReactNode,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import type {
  AvatarPlaybackState,
  AvatarRuntimeConfig,
  AvatarTranslationRequest,
} from "../models.js";

const HANDTALK_SCRIPT_ATTRIBUTE = "data-signbridge-handtalk-sdk";
const HANDTALK_HOST_ID = "signbridge-handtalk-avatar";
const READY_TIMEOUT_MS = 15_000;

type HandTalkApplicationState = string | Record<string, unknown>;

interface HandTalkApi {
  isLoaded: boolean;
  active(): void;
  disable(): Promise<void>;
  translate(sentence: string): Promise<void>;
  pause(): void;
  resume(): void;
  repeat(): Promise<void>;
  stop(): Promise<void>;
  maximize(): void;
  changeAnimationSpeed(speed: "normal" | "slow" | "fast"): void;
  getApplicationState(): HandTalkApplicationState;
  onApplicationStateChange(
    callback: (state: HandTalkApplicationState) => void,
  ): () => void;
}

interface HandTalkConstructor {
  new (config: Record<string, unknown>): HandTalkApi;
}

declare global {
  interface Window {
    HTApi?: HandTalkConstructor;
  }
}

export interface HandTalkAvatarHandle {
  translate(text: string): Promise<void>;
  pause(): void;
  resume(): void;
  repeat(): Promise<void>;
  stop(): Promise<void>;
  changeSpeed(speed: "normal" | "slow" | "fast"): void;
}

interface HandTalkAvatarProps {
  config: AvatarRuntimeConfig | null;
  request: AvatarTranslationRequest | null;
  caption: string;
  onStateChange?: (state: AvatarPlaybackState) => void;
  onError?: (message: string) => void;
}

let sdkLoadPromise: Promise<void> | null = null;
let loadedSdkUrl: string | null = null;

export const HandTalkAvatar = forwardRef<HandTalkAvatarHandle, HandTalkAvatarProps>(
  function HandTalkAvatar(props, ref): ReactNode {
    const apiRef = useRef<HandTalkApi | null>(null);
    const initializeRef = useRef<Promise<void> | null>(null);
    const unsubscribeRef = useRef<(() => void) | null>(null);
    const lastRequestIdRef = useRef<string | null>(null);
    const queueGenerationRef = useRef(0);
    const translationChainRef = useRef<Promise<void>>(Promise.resolve());
    const mountedRef = useRef(true);
    const [state, setState] = useState<AvatarPlaybackState>(
      props.config?.enabled ? "loading" : "unavailable",
    );

    const updateState = (next: AvatarPlaybackState): void => {
      if (!mountedRef.current) return;
      setState(next);
      props.onStateChange?.(next);
    };

    const reportError = (message: string): void => {
      updateState("error");
      props.onError?.(message);
    };

    async function translateNow(text: string, generation: number): Promise<void> {
      const normalized = text.trim();
      const config = props.config;
      if (!config?.enabled || !config.token || !config.sdkUrl) {
        throw new Error("The experimental ASL avatar is not configured for this site.");
      }
      if (!normalized) throw new Error("Enter or speak a message before starting the avatar.");
      if (normalized.length > config.maxCharacters) {
        throw new Error(`Keep each avatar message under ${config.maxCharacters} characters.`);
      }

      await initializeRef.current;
      if (generation !== queueGenerationRef.current) return;
      const api = apiRef.current;
      if (!api) throw new Error("The ASL avatar could not be initialized.");

      let current = normalizedApplicationState(api.getApplicationState());
      if (current === "translating") current = await waitForApplicationState(api, ["ready", "minimized"]);
      if (generation !== queueGenerationRef.current) return;
      if (current === "minimized") {
        api.maximize();
        await waitForApplicationState(api, ["ready"]);
      } else if (current !== "ready") {
        await waitForApplicationState(api, ["ready"]);
      }

      updateState("translating");
      await api.translate(normalized);
      await waitForApplicationState(api, ["ready", "minimized"]);
      if (generation === queueGenerationRef.current) updateState("ready");
    }

    function translate(text: string): Promise<void> {
      const config = props.config;
      const chunks = splitAvatarText(text, config?.maxCharacters ?? 1_000);
      if (chunks.length === 0) {
        return Promise.reject(new Error("Enter or speak a message before starting the avatar."));
      }
      const generation = queueGenerationRef.current;
      for (const chunk of chunks) {
        translationChainRef.current = translationChainRef.current
          .catch(() => undefined)
          .then(() => translateNow(chunk, generation));
      }
      return translationChainRef.current;
    }

    useImperativeHandle(ref, () => ({
      translate,
      pause: () => {
        apiRef.current?.pause();
        updateState("paused");
      },
      resume: () => {
        apiRef.current?.resume();
        updateState("translating");
      },
      repeat: async () => {
        const api = apiRef.current;
        if (!api) throw new Error("The ASL avatar is not ready.");
        updateState("translating");
        await api.repeat();
      },
      stop: async () => {
        queueGenerationRef.current += 1;
        translationChainRef.current = Promise.resolve();
        const api = apiRef.current;
        if (!api) return;
        const current = normalizedApplicationState(api.getApplicationState());
        if (current === "translating") await api.stop();
        updateState("ready");
      },
      changeSpeed: (speed) => apiRef.current?.changeAnimationSpeed(speed),
    }));

    useEffect(() => {
      mountedRef.current = true;
      let disposed = false;
      const config = props.config;
      if (!config?.enabled || !config.token || !config.sdkUrl) {
        updateState("unavailable");
        initializeRef.current = null;
        return () => {
          mountedRef.current = false;
        };
      }

      updateState("loading");
      const initialization = (async () => {
        if (!isPinnedHandTalkSdkUrl(config.sdkUrl ?? "")) {
          throw new Error("The configured Hand Talk SDK URL is not a pinned official release.");
        }
        await loadHandTalkSdk(config.sdkUrl ?? "");
        if (disposed) return;
        if (!window.HTApi) throw new Error("The Hand Talk SDK did not expose its browser API.");

        const api = new window.HTApi({
          token: config.token,
          avatar: config.avatar,
          language: config.language,
          signLanguage: config.signLanguage,
          parentElementSelector: `#${HANDTALK_HOST_ID}`,
          enableComponents: {
            caption: false,
            changeSpeedButton: true,
            header: false,
            pauseAnimationButton: true,
            rateAnimationButton: true,
            repeatAnimationButton: true,
            stopAnimationButton: true,
            widget: false,
            zoom: true,
            rotate: false,
          },
          theme: {
            translationWindow: {
              layout: "absolute",
              draggable: false,
              position: { preset: "topLeft", top: "0", right: "", bottom: "", left: "0" },
              width: "100%",
              height: "100%",
              background: "#f2f7f5",
              border: { width: "0", color: "transparent", style: "solid", radius: "18px" },
              shadow: [],
            },
          },
        });
        apiRef.current = api;
        unsubscribeRef.current = api.onApplicationStateChange((applicationState) => {
          const next = avatarStateFromApplicationState(applicationState);
          if (next) updateState(next);
        });
        api.active();
        await waitForApplicationState(api, ["ready"]);
        updateState("ready");
      })();
      initializeRef.current = initialization;
      void initialization.catch((error: unknown) => {
        reportError(publicAvatarError(error));
      });

      return () => {
        disposed = true;
        mountedRef.current = false;
        queueGenerationRef.current += 1;
        translationChainRef.current = Promise.resolve();
        lastRequestIdRef.current = null;
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
        const api = apiRef.current;
        apiRef.current = null;
        initializeRef.current = null;
        if (api) void api.disable().catch(() => undefined);
      };
      // Configuration is immutable for one authenticated session.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.config]);

    useEffect(() => {
      const request = props.request;
      if (!request || request.id === lastRequestIdRef.current || !props.config?.enabled) return;
      lastRequestIdRef.current = request.id;
      void translate(request.text).catch((error: unknown) => {
        reportError(publicAvatarError(error));
      });
      // translate intentionally reads the latest provider instance and configuration.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.request]);

    return (
      <div className={`handtalk-avatar state-${state}`}>
        <div
          id={HANDTALK_HOST_ID}
          className="handtalk-avatar-host"
          role="img"
          aria-label={props.caption
            ? `Experimental synthetic ASL avatar for: ${props.caption}`
            : "Experimental synthetic ASL avatar"}
        />
        <div className="avatar-status" role="status" aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {avatarStateLabel(state)}
        </div>
      </div>
    );
  },
);

export function isPinnedHandTalkSdkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "api-cdn.handtalk.me"
      && /^\/sdk\/\d+\.\d+\.\d+\/ht-api-sdk\.min\.js$/.test(url.pathname)
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

export function splitAvatarText(value: string, maxCharacters: number): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
    throw new RangeError("maxCharacters must be a positive integer");
  }

  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [normalized];
  const chunks: string[] = [];
  let current = "";
  const flush = (): void => {
    const next = current.trim();
    if (next) chunks.push(next);
    current = "";
  };
  for (const sentence of sentences.map((part) => part.trim()).filter(Boolean)) {
    if (sentence.length <= maxCharacters) {
      const combined = current ? `${current} ${sentence}` : sentence;
      if (combined.length <= maxCharacters) {
        current = combined;
      } else {
        flush();
        current = sentence;
      }
      continue;
    }
    flush();
    const words = sentence.split(" ");
    for (const word of words) {
      if (word.length > maxCharacters) {
        flush();
        for (let index = 0; index < word.length; index += maxCharacters) {
          chunks.push(word.slice(index, index + maxCharacters));
        }
        continue;
      }
      const combined = current ? `${current} ${word}` : word;
      if (combined.length > maxCharacters) flush();
      current = current ? `${current} ${word}` : word;
    }
  }
  flush();
  return chunks;
}

function loadHandTalkSdk(url: string): Promise<void> {
  if (window.HTApi && loadedSdkUrl === url) return Promise.resolve();
  if (sdkLoadPromise && loadedSdkUrl === url) return sdkLoadPromise;
  if (loadedSdkUrl && loadedSdkUrl !== url) {
    return Promise.reject(new Error("A different Hand Talk SDK release is already loaded."));
  }

  loadedSdkUrl = url;
  sdkLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[${HANDTALK_SCRIPT_ATTRIBUTE}]`);
    if (existing) {
      if (window.HTApi) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("The Hand Talk SDK could not be loaded.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.setAttribute(HANDTALK_SCRIPT_ATTRIBUTE, "true");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("The Hand Talk SDK could not be loaded.")), { once: true });
    document.head.append(script);
  });
  const promise = sdkLoadPromise;
  void promise.catch(() => {
    document.querySelector<HTMLScriptElement>(`script[${HANDTALK_SCRIPT_ATTRIBUTE}]`)?.remove();
    sdkLoadPromise = null;
    loadedSdkUrl = null;
  });
  return promise;
}

async function waitForApplicationState(
  api: HandTalkApi,
  accepted: readonly string[],
  timeoutMs = READY_TIMEOUT_MS,
): Promise<string> {
  const current = normalizedApplicationState(api.getApplicationState());
  if (accepted.includes(current)) return current;

  return new Promise((resolve, reject) => {
    let unsubscribe = (): void => undefined;
    const timer = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("The ASL avatar did not become ready in time."));
    }, timeoutMs);
    unsubscribe = api.onApplicationStateChange((applicationState) => {
      const next = normalizedApplicationState(applicationState);
      if (!accepted.includes(next)) return;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(next);
    });
  });
}

function normalizedApplicationState(value: HandTalkApplicationState): string {
  if (typeof value === "string") return value.toLowerCase();
  for (const key of ["state", "status", "name", "value"] as const) {
    const candidate = value[key];
    if (typeof candidate === "string") return candidate.toLowerCase();
  }
  return "unknown";
}

function avatarStateFromApplicationState(value: HandTalkApplicationState): AvatarPlaybackState | null {
  const state = normalizedApplicationState(value);
  if (state === "translating") return "translating";
  if (state === "ready" || state === "minimized" || state === "rating") return "ready";
  if (state === "paused") return "paused";
  if (state === "loading" || state === "initializing") return "loading";
  if (state === "error" || state === "disabled") return "error";
  return null;
}

function avatarStateLabel(state: AvatarPlaybackState): string {
  const labels: Record<AvatarPlaybackState, string> = {
    unavailable: "Avatar provider not configured",
    loading: "Loading experimental ASL avatar",
    ready: "Experimental ASL avatar ready",
    translating: "Experimental avatar signing",
    paused: "Avatar paused",
    error: "Avatar unavailable; use captions",
  };
  return labels[state];
}

function publicAvatarError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The experimental ASL avatar is unavailable. Keep the English caption visible.";
}
