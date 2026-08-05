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
const SDK_LOAD_TIMEOUT_MS = 15_000;
const READY_TIMEOUT_MS = 15_000;
const TRANSLATE_TIMEOUT_MS = 20_000;
const PLAYBACK_START_TIMEOUT_MS = 10_000;
const PLAYBACK_COMPLETION_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 3_000;

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

export interface AvatarExecutionEvent {
  requestId: string;
  result: "started" | "completed" | "failed" | "canceled";
}

interface HandTalkAvatarProps {
  config: AvatarRuntimeConfig | null;
  request: AvatarTranslationRequest | null;
  caption: string;
  onStateChange?: (state: AvatarPlaybackState) => void;
  onError?: (message: string) => void;
  onExecutionEvent?: (event: AvatarExecutionEvent) => void;
}

interface SdkLoadState {
  url: string;
  promise: Promise<void>;
}

interface AvatarOperationTicket {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  commit(effect: () => void): boolean;
}

interface AvatarOperationCoordinator {
  begin(): AvatarOperationTicket;
  cancel(): void;
  complete(ticket: AvatarOperationTicket): void;
  hasCurrent(): boolean;
}

export class AvatarOperationCancelledError extends Error {
  constructor() {
    super("The avatar operation was cancelled.");
    this.name = "AvatarOperationCancelledError";
  }
}

export class AvatarOperationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarOperationTimeoutError";
  }
}

let sdkLoadState: SdkLoadState | null = null;
let loadedSdkUrl: string | null = null;

export const HandTalkAvatar = forwardRef<HandTalkAvatarHandle, HandTalkAvatarProps>(
  function HandTalkAvatar(props, ref): ReactNode {
    const apiRef = useRef<HandTalkApi | null>(null);
    const initializeRef = useRef<Promise<void> | null>(null);
    const configurationControllerRef = useRef<AbortController | null>(null);
    const unsubscribeRef = useRef<(() => void) | null>(null);
    const lastRequestIdRef = useRef<string | null>(null);
    const activeExecutionRef = useRef<{
      requestId: string;
      ticket: AvatarOperationTicket;
      started: boolean;
      terminal: boolean;
    } | null>(null);
    const operationCoordinatorRef = useRef<AvatarOperationCoordinator>(
      createAvatarOperationCoordinator(),
    );
    const providerPoisonedRef = useRef(false);
    const configEpochRef = useRef(0);
    const mountedRef = useRef(true);
    const [state, setState] = useState<AvatarPlaybackState>(
      props.config?.enabled ? "loading" : "unavailable",
    );

    const updateState = (
      next: AvatarPlaybackState,
      epoch = configEpochRef.current,
    ): void => {
      if (!mountedRef.current || epoch !== configEpochRef.current) return;
      setState(next);
      props.onStateChange?.(next);
    };

    const reportError = (
      message: string,
      epoch = configEpochRef.current,
    ): void => {
      if (!mountedRef.current || epoch !== configEpochRef.current) return;
      updateState("error", epoch);
      props.onError?.(message);
    };

    const emitExecution = (
      execution: NonNullable<typeof activeExecutionRef.current>,
      result: AvatarExecutionEvent["result"],
    ): void => {
      if (!mountedRef.current || execution.terminal) return;
      if (result === "started") {
        if (execution.started) return;
        execution.started = true;
      } else {
        execution.terminal = true;
      }
      props.onExecutionEvent?.({ requestId: execution.requestId, result });
    };

    const poisonProvider = (api: HandTalkApi): void => {
      if (providerPoisonedRef.current) return;
      providerPoisonedRef.current = true;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      if (apiRef.current === api) apiRef.current = null;
      initializeRef.current = null;
      configurationControllerRef.current?.abort();
      configurationControllerRef.current = null;
      const host = document.getElementById(HANDTALK_HOST_ID);
      host?.replaceChildren();
      host?.removeAttribute("id");
      updateState("error");
      void withAvatarOperationTimeout(
        Promise.resolve().then(() => api.disable()),
        STOP_TIMEOUT_MS,
        "The avatar provider could not be disabled in time.",
      ).catch(() => undefined);
    };

    async function translateNow(
      text: string,
      ticket: AvatarOperationTicket,
      onProviderStart: () => void,
    ): Promise<void> {
      const normalized = text.trim();
      const config = props.config;
      if (!config?.enabled || !config.token || !config.sdkUrl) {
        throw new Error("The experimental ASL avatar is not configured for this site.");
      }
      if (!normalized) throw new Error("Enter or speak a message before starting the avatar.");
      if (normalized.length > config.maxCharacters) {
        throw new Error(`Keep each avatar message under ${config.maxCharacters} characters.`);
      }

      await awaitWithAvatarCancellation(initializeRef.current, ticket.signal);
      throwIfAvatarOperationCancelled(ticket.signal);
      const api = apiRef.current;
      if (!api) throw new Error("The ASL avatar could not be initialized.");

      let current = normalizedApplicationState(api.getApplicationState());
      if (current === "translating" || current === "paused") {
        current = await waitForApplicationState(api, ["ready", "minimized"], {
          signal: ticket.signal,
        });
      }
      throwIfAvatarOperationCancelled(ticket.signal);
      if (current === "minimized") {
        api.maximize();
        await waitForApplicationState(api, ["ready"], { signal: ticket.signal });
      } else if (current !== "ready") {
        await waitForApplicationState(api, ["ready"], { signal: ticket.signal });
      }

      const stepController = new AbortController();
      const cancelStep = (): void => stepController.abort();
      ticket.signal.addEventListener("abort", cancelStep, { once: true });
      let invocationStarted = false;
      const started = waitForApplicationState(api, ["translating"], {
        timeoutMs: PLAYBACK_START_TIMEOUT_MS,
        timeoutMessage: "The avatar did not start the message in time. Try again or use captions.",
        acceptCurrent: false,
        eventGate: () => invocationStarted,
        signal: stepController.signal,
      }).then(() => {
        ticket.commit(onProviderStart);
      });

      try {
        const accepted = withAvatarOperationTimeout(
          Promise.resolve().then(() => {
            invocationStarted = true;
            return api.translate(normalized);
          }),
          TRANSLATE_TIMEOUT_MS,
          "The avatar provider did not accept the message within 20 seconds. Try again or use captions.",
          stepController.signal,
        );
        await Promise.all([accepted, started]);
        await waitForApplicationState(api, ["ready", "minimized"], {
          timeoutMs: PLAYBACK_COMPLETION_TIMEOUT_MS,
          timeoutMessage: "The avatar did not finish the message within two minutes. Keep the caption visible and try again.",
          signal: ticket.signal,
        });
      } catch (error: unknown) {
        stepController.abort();
        await started.catch(() => undefined);
        if (error instanceof AvatarOperationTimeoutError) {
          poisonProvider(api);
        } else if (!(error instanceof AvatarOperationCancelledError)) {
          try {
            await stopProviderMotion(api, ticket.signal);
          } catch {
            poisonProvider(api);
          }
        }
        throw error;
      } finally {
        ticket.signal.removeEventListener("abort", cancelStep);
      }
    }

    async function translate(text: string, requestId?: string): Promise<void> {
      if (providerPoisonedRef.current) {
        throw new Error("The avatar provider was stopped after a timeout. Switch modes and reactivate it before trying again.");
      }
      const config = props.config;
      const chunks = splitAvatarText(text, config?.maxCharacters ?? 1_000);
      if (chunks.length === 0) {
        throw new Error("Enter or speak a message before starting the avatar.");
      }

      const coordinator = operationCoordinatorRef.current;
      const api = apiRef.current;
      const shouldStopPrior = coordinator.hasCurrent()
        || (api ? isActiveApplicationState(api.getApplicationState()) : false);
      const priorExecution = activeExecutionRef.current;
      const ticket = coordinator.begin();
      if (priorExecution && !priorExecution.terminal) emitExecution(priorExecution, "canceled");
      const execution = requestId
        ? { requestId, ticket, started: false, terminal: false }
        : null;
      activeExecutionRef.current = execution;

      try {
        if (shouldStopPrior && api) {
          try {
            await stopProviderMotion(api, ticket.signal);
          } catch (error: unknown) {
            poisonProvider(api);
            throw error;
          }
        }
        for (const chunk of chunks) {
          await translateNow(chunk, ticket, () => {
            if (execution) emitExecution(execution, "started");
          });
        }
        ticket.commit(() => {
          updateState("ready");
          if (execution) emitExecution(execution, "completed");
        });
      } catch (error: unknown) {
        if (!ticket.isCurrent() || ticket.signal.aborted) {
          throw new AvatarOperationCancelledError();
        }
        if (execution) emitExecution(execution, "failed");
        throw error;
      } finally {
        coordinator.complete(ticket);
        if (activeExecutionRef.current?.ticket === ticket) activeExecutionRef.current = null;
      }
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
        if (providerPoisonedRef.current) {
          throw new Error("The avatar provider must be reactivated before replaying a message.");
        }
        const api = apiRef.current;
        if (!api) throw new Error("The ASL avatar is not ready.");
        try {
          await withAvatarOperationTimeout(
            Promise.resolve().then(() => api.repeat()),
            TRANSLATE_TIMEOUT_MS,
            "The avatar did not repeat the message in time. Use captions or try again.",
            configurationControllerRef.current?.signal,
          );
        } catch (error: unknown) {
          if (error instanceof AvatarOperationTimeoutError) poisonProvider(api);
          throw error;
        }
      },
      stop: async () => {
        const coordinator = operationCoordinatorRef.current;
        const hadActiveOperation = coordinator.hasCurrent();
        const execution = activeExecutionRef.current;
        coordinator.cancel();
        if (execution && !execution.terminal) emitExecution(execution, "canceled");
        activeExecutionRef.current = null;
        const api = apiRef.current;
        if (!api) return;
        const current = normalizedApplicationState(api.getApplicationState());
        if (hadActiveOperation || current === "translating" || current === "paused") {
          try {
            await stopProviderMotion(api, configurationControllerRef.current?.signal);
          } catch (error: unknown) {
            poisonProvider(api);
            throw error;
          }
        }
        updateState("ready");
      },
      changeSpeed: (speed) => apiRef.current?.changeAnimationSpeed(speed),
    }));

    useEffect(() => {
      mountedRef.current = true;
      let disposed = false;
      const epoch = configEpochRef.current + 1;
      configEpochRef.current = epoch;
      providerPoisonedRef.current = false;
      const config = props.config;
      if (!config?.enabled || !config.token || !config.sdkUrl) {
        updateState("unavailable", epoch);
        initializeRef.current = null;
        return () => {
          if (configEpochRef.current === epoch) {
            configEpochRef.current += 1;
            mountedRef.current = false;
          }
        };
      }

      updateState("loading", epoch);
      const initializationController = new AbortController();
      configurationControllerRef.current = initializationController;
      const initialization = (async () => {
        if (!isPinnedHandTalkSdkUrl(config.sdkUrl ?? "")) {
          throw new Error("The configured Hand Talk SDK URL is not a pinned official release.");
        }
        await loadHandTalkSdk(config.sdkUrl ?? "", {
          signal: initializationController.signal,
        });
        throwIfAvatarOperationCancelled(initializationController.signal);
        if (disposed) throw new AvatarOperationCancelledError();
        if (!window.HTApi) throw new Error("The Hand Talk SDK did not expose its browser API.");

        const api = new window.HTApi({
          token: config.token,
          avatar: config.avatar,
          language: config.language,
          signLanguage: config.signLanguage,
          parentElementSelector: `#${HANDTALK_HOST_ID}`,
          enableComponents: {
            caption: false,
            changeSpeedButton: false,
            header: false,
            pauseAnimationButton: false,
            rateAnimationButton: false,
            repeatAnimationButton: false,
            stopAnimationButton: false,
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
          if (!next) return;
          if (next === "ready" && operationCoordinatorRef.current.hasCurrent()) return;
          updateState(next, epoch);
        });
        api.active();
        await waitForApplicationState(api, ["ready"], {
          signal: initializationController.signal,
        });
        updateState("ready", epoch);
      })();
      initializeRef.current = initialization;
      void initialization.catch((error: unknown) => {
        if (disposed || error instanceof AvatarOperationCancelledError) return;
        const api = apiRef.current;
        if (api) poisonProvider(api);
        reportError(publicAvatarError(error), epoch);
      });

      return () => {
        disposed = true;
        if (configEpochRef.current === epoch) {
          configEpochRef.current += 1;
          mountedRef.current = false;
        }
        initializationController.abort();
        if (configurationControllerRef.current === initializationController) {
          configurationControllerRef.current = null;
        }
        const coordinator = operationCoordinatorRef.current;
        const hadActiveOperation = coordinator.hasCurrent();
        coordinator.cancel();
        activeExecutionRef.current = null;
        lastRequestIdRef.current = null;
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
        const api = apiRef.current;
        apiRef.current = null;
        initializeRef.current = null;
        if (api) {
          if (hadActiveOperation) void api.stop().catch(() => undefined);
          void api.disable().catch(() => undefined);
        }
      };
      // Configuration is immutable for one authenticated session.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.config]);

    useEffect(() => {
      const request = props.request;
      if (!request || request.id === lastRequestIdRef.current || !props.config?.enabled) return;
      lastRequestIdRef.current = request.id;
      void translate(request.text, request.id).catch((error: unknown) => {
        if (error instanceof AvatarOperationCancelledError) return;
        reportError(publicAvatarError(error));
      });
      // translate intentionally reads the latest provider instance and configuration.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.request, props.config?.enabled]);

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

export function loadHandTalkSdk(
  url: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? SDK_LOAD_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new RangeError("The SDK load timeout must be positive."));
  }
  if (options.signal?.aborted) return Promise.reject(new AvatarOperationCancelledError());
  if (window.HTApi && loadedSdkUrl === url) return Promise.resolve();
  if (sdkLoadState) {
    return sdkLoadState.url === url
      ? awaitWithAvatarCancellation(sdkLoadState.promise, options.signal)
      : Promise.reject(new Error("A different Hand Talk SDK release is already loading."));
  }
  if (loadedSdkUrl && loadedSdkUrl !== url) {
    return Promise.reject(new Error("A different Hand Talk SDK release is already loaded."));
  }

  let resolvePromise = (): void => undefined;
  let rejectPromise = (_error: Error): void => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const loadState: SdkLoadState = { url, promise };
  sdkLoadState = loadState;

  const existing = document.querySelector<HTMLScriptElement>(`script[${HANDTALK_SCRIPT_ATTRIBUTE}]`);
  if (existing && !window.HTApi) existing.remove();
  const script = window.HTApi && existing ? existing : document.createElement("script");
  let settled = false;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

  const cleanup = (): void => {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    script.removeEventListener("load", handleLoad);
    script.removeEventListener("error", handleError);
    options.signal?.removeEventListener("abort", handleAbort);
  };
  const fail = (error: Error): void => {
    if (settled) return;
    settled = true;
    cleanup();
    if (sdkLoadState === loadState) sdkLoadState = null;
    if (!window.HTApi) loadedSdkUrl = null;
    script.remove();
    rejectPromise(error);
  };
  const succeed = (): void => {
    if (settled) return;
    if (!window.HTApi) {
      fail(new Error("The Hand Talk SDK loaded without exposing its browser API. Try again or use captions."));
      return;
    }
    settled = true;
    cleanup();
    if (sdkLoadState === loadState) sdkLoadState = null;
    loadedSdkUrl = url;
    resolvePromise();
  };
  function handleLoad(): void {
    succeed();
  }
  function handleError(): void {
    fail(new Error("The Hand Talk SDK could not be loaded. Check the network, then try again or use captions."));
  }
  function handleAbort(): void {
    fail(new AvatarOperationCancelledError());
  }

  script.addEventListener("load", handleLoad, { once: true });
  script.addEventListener("error", handleError, { once: true });
  options.signal?.addEventListener("abort", handleAbort, { once: true });
  timer = globalThis.setTimeout(() => {
    fail(new Error("The Hand Talk SDK did not load within 15 seconds. Check the network, then try again or use captions."));
  }, timeoutMs);

  if (window.HTApi) {
    succeed();
  } else {
    script.src = url;
    script.async = true;
    script.setAttribute(HANDTALK_SCRIPT_ATTRIBUTE, "true");
    document.head.append(script);
  }

  return promise;
}

export async function waitForApplicationState(
  api: HandTalkApi,
  accepted: readonly string[],
  options: {
    timeoutMs?: number;
    timeoutMessage?: string;
    signal?: AbortSignal;
    acceptCurrent?: boolean;
    eventGate?: () => boolean;
  } = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? READY_TIMEOUT_MS;
  throwIfAvatarOperationCancelled(options.signal);
  if (options.acceptCurrent !== false) {
    const current = normalizedApplicationState(api.getApplicationState());
    if (accepted.includes(current)) return current;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = (): void => undefined;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) globalThis.clearTimeout(timer);
      options.signal?.removeEventListener("abort", handleAbort);
      unsubscribe();
    };
    const finish = (next: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(next);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    function handleAbort(): void {
      fail(new AvatarOperationCancelledError());
    }
    const subscribedUnsubscribe = api.onApplicationStateChange((applicationState) => {
      const next = normalizedApplicationState(applicationState);
      if (accepted.includes(next) && (options.eventGate?.() ?? true)) finish(next);
    });
    unsubscribe = subscribedUnsubscribe;
    if (settled) {
      unsubscribe();
      return;
    }
    if (options.acceptCurrent !== false) {
      const afterSubscription = normalizedApplicationState(api.getApplicationState());
      if (accepted.includes(afterSubscription)) {
        finish(afterSubscription);
        return;
      }
    }
    if (settled) return;
    options.signal?.addEventListener("abort", handleAbort, { once: true });
    if (options.signal?.aborted) {
      handleAbort();
      return;
    }
    timer = globalThis.setTimeout(() => {
      fail(new AvatarOperationTimeoutError(
        options.timeoutMessage
          ?? "The ASL avatar did not become ready in time. Try again or use captions.",
      ));
    }, timeoutMs);
  });
}

export function withAvatarOperationTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  timeoutMessage: string,
  signal?: AbortSignal,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new RangeError("The avatar operation timeout must be positive."));
  }
  if (signal?.aborted) return Promise.reject(new AvatarOperationCancelledError());

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", handleAbort);
    };
    const succeed = (value: T): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    function handleAbort(): void {
      fail(new AvatarOperationCancelledError());
    }
    const timer = globalThis.setTimeout(() => fail(new AvatarOperationTimeoutError(timeoutMessage)), timeoutMs);
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    void Promise.resolve(operation).then(succeed, fail);
  });
}

export function createAvatarOperationCoordinator(): AvatarOperationCoordinator {
  let current: { controller: AbortController; ticket: AvatarOperationTicket } | null = null;

  return {
    begin(): AvatarOperationTicket {
      current?.controller.abort();
      const controller = new AbortController();
      const ticket: AvatarOperationTicket = {
        signal: controller.signal,
        isCurrent: () => current?.ticket === ticket && !controller.signal.aborted,
        commit(effect): boolean {
          if (!ticket.isCurrent()) return false;
          effect();
          return true;
        },
      };
      current = { controller, ticket };
      return ticket;
    },
    cancel(): void {
      current?.controller.abort();
      current = null;
    },
    complete(ticket): void {
      if (current?.ticket === ticket) current = null;
    },
    hasCurrent: () => current !== null,
  };
}

async function awaitWithAvatarCancellation<T>(
  operation: PromiseLike<T> | null,
  signal?: AbortSignal,
): Promise<T> {
  if (!operation) throw new Error("The ASL avatar could not be initialized.");
  throwIfAvatarOperationCancelled(signal);
  if (!signal) return operation;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener("abort", handleAbort);
    const succeed = (value: T): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    function handleAbort(): void {
      fail(new AvatarOperationCancelledError());
    }
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) {
      handleAbort();
      return;
    }
    void Promise.resolve(operation).then(succeed, fail);
  });
}

function throwIfAvatarOperationCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AvatarOperationCancelledError();
}

function isActiveApplicationState(value: HandTalkApplicationState): boolean {
  const state = normalizedApplicationState(value);
  return state === "translating" || state === "paused";
}

async function stopProviderMotion(api: HandTalkApi, signal?: AbortSignal): Promise<void> {
  try {
    await withAvatarOperationTimeout(
      api.stop(),
      STOP_TIMEOUT_MS,
      "The avatar could not stop the previous message in time. Use captions and try again.",
      signal,
    );
    await waitForApplicationState(api, ["ready", "minimized"], {
      timeoutMs: STOP_TIMEOUT_MS,
      timeoutMessage: "The avatar did not return to ready in time. Use captions and try again.",
      ...(signal ? { signal } : {}),
    });
  } catch (error: unknown) {
    if (error instanceof AvatarOperationCancelledError) throw error;
    if (error instanceof Error && error.message.includes("in time")) throw error;
    throw new Error("The avatar could not stop the previous message. Use captions and try again.");
  }
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
