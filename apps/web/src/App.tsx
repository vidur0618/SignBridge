import {
  type ChangeEvent,
  type FormEvent,
  type RefObject,
  type ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { runAvatarSafetyGate } from "@signbridge/contracts";
import {
  ApiError,
  CURRENT_CONSENT_VERSION,
  authorizeAvatar,
  endSession,
  exchangeSession,
  loadCatalog,
  loadAvatarConfig,
  loadMetrics,
  reportAvatarExecution,
  reportPlayback,
  sendFeedback,
  submitDecision,
  transcribeAudio,
  type SessionInfo,
} from "./api.js";
import { HandTalkAvatar, type HandTalkAvatarHandle } from "./avatar/HandTalkAvatar.js";
import { classifyDemoTranscript, DEMO_CATALOG, DEMO_TRANSCRIPT, getIntent, validateAudioFile } from "./demo.js";
import { LiveTranscriptionSocket } from "./liveTranscription.js";
import { PcmMicrophone } from "./microphone.js";
import type {
  AvatarPlaybackState,
  AvatarMessageSource,
  AvatarRuntimeConfig,
  AvatarTranslationRequest,
  DashboardMetrics,
  ExperienceMode,
  InputMethod,
  IntentCandidate,
  LiveCaptionEvent,
  PlaybackAsset,
  PendingAvatarMessage,
  PublicCatalog,
  RuntimeMode,
} from "./models.js";

type ConnectionState = "idle" | "connecting" | "connected" | "offline";
type ProcessState = "idle" | "preparing" | "listening" | "finalizing" | "classifying" | "caption_ready" | "candidate" | "avatar_confirmation" | "fallback" | "playing";

const INPUT_TABS: Array<{ id: InputMethod; label: string; detail: string }> = [
  { id: "speak", label: "Speak", detail: "Push to talk" },
  { id: "upload", label: "Upload", detail: "Audio file" },
  { id: "type", label: "Type", detail: "English message" },
  { id: "phrases", label: "Phrases", detail: "Select manually" },
];

const FALLBACK_COPY: Record<string, string> = {
  high_stakes_content: "This may be consequential communication. Use a qualified interpreter or appropriate support.",
  outside_pilot_domain: "This message falls outside the ten reception phrases in this pilot.",
  out_of_domain: "This message falls outside the ten reception phrases in this pilot.",
  utterance_too_long: "This message is too long for safe phrase selection. Use captions or type instead.",
  transcript_too_long: "This message is too long for safe phrase selection. Use captions or type instead.",
  empty_transcript: "No final speech was captured. Try again or type the message.",
  no_final_transcript: "No final transcript arrived. The provisional text was not classified.",
  connection_lost: "The speech connection ended. Keep the caption visible or start a new message.",
  connection_timeout: "The speech connection was not ready before the capture limit.",
  speech_connection_unavailable: "Live transcription could not connect. Use typing or try a new message.",
  classification_timeout: "The final caption is available, but phrase selection timed out.",
  staff_rejected: "Staff chose not to play a signing video. The English caption remains available.",
  typed_caption: "Typed messages stay as English captions and are not translated automatically.",
  manual_caption: "This manual phrase is displayed as a caption. No signing video has been requested.",
  avatar_unavailable: "The experimental ASL avatar is not configured for this site. Keep the caption visible or use the reviewed phrase lane.",
  avatar_error: "The experimental ASL avatar could not complete this message. Keep the English caption visible.",
};

const DISABLED_AVATAR_CONFIG: AvatarRuntimeConfig = {
  provider: "handtalk",
  enabled: false,
  status: "experimental",
  avatar: "HUGO",
  language: "enUS",
  signLanguage: "en-ase",
  maxCharacters: 1_000,
};

export function App(): ReactNode {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [runtime, setRuntime] = useState<RuntimeMode>("live");
  const [view, setView] = useState<"reception" | "metrics">("reception");
  const [catalog, setCatalog] = useState<PublicCatalog>(DEMO_CATALOG);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [mode, setMode] = useState<ExperienceMode>("captions_only");
  const [inputMethod, setInputMethod] = useState<InputMethod>("speak");
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [processState, setProcessState] = useState<ProcessState>("idle");
  const [provisional, setProvisional] = useState("");
  const [finalCaption, setFinalCaption] = useState("");
  const [candidate, setCandidate] = useState<IntentCandidate | null>(null);
  const [asset, setAsset] = useState<PlaybackAsset | null>(null);
  const [fallbackReason, setFallbackReason] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [typedMessage, setTypedMessage] = useState("");
  const [selectedPhrase, setSelectedPhrase] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsError, setMetricsError] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [avatarConfig, setAvatarConfig] = useState<AvatarRuntimeConfig | null>(DISABLED_AVATAR_CONFIG);
  const [avatarActivationAcknowledged, setAvatarActivationAcknowledged] = useState(false);
  const [avatarActivated, setAvatarActivated] = useState(false);
  const [pendingAvatarMessage, setPendingAvatarMessage] = useState<PendingAvatarMessage | null>(null);
  const [avatarRequest, setAvatarRequest] = useState<AvatarTranslationRequest | null>(null);
  const [avatarState, setAvatarState] = useState<AvatarPlaybackState>("unavailable");

  const microphoneRef = useRef(new PcmMicrophone());
  const socketRef = useRef<LiveTranscriptionSocket | null>(null);
  const finalReceivedRef = useRef(false);
  const finalTranscriptRef = useRef("");
  const finalTimerRef = useRef<number | null>(null);
  const responseTimerRef = useRef<number | null>(null);
  const captureDeadlineTimerRef = useRef<number | null>(null);
  const microphoneOpenedAtRef = useRef<number | null>(null);
  const demoPartialTimerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const avatarRef = useRef<HandTalkAvatarHandle | null>(null);
  const avatarExecutionRef = useRef<{
    authorizationId: string;
    authorizedAt: number;
    started: boolean;
    terminal: boolean;
  } | null>(null);
  const confirmationRef = useRef<HTMLElement | null>(null);
  const workGenerationRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const handleLiveEventRef = useRef<(event: LiveCaptionEvent) => void>(() => undefined);

  const cancelActiveWork = useCallback(() => {
    workGenerationRef.current += 1;
    stopRequestedRef.current = true;
    socketRef.current?.close();
    socketRef.current = null;
    void microphoneRef.current.stop().catch(() => undefined);
    videoRef.current?.pause();
    void avatarRef.current?.stop().catch(() => undefined);
    if (finalTimerRef.current !== null) {
      window.clearTimeout(finalTimerRef.current);
      finalTimerRef.current = null;
    }
    if (responseTimerRef.current !== null) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
    if (captureDeadlineTimerRef.current !== null) {
      window.clearTimeout(captureDeadlineTimerRef.current);
      captureDeadlineTimerRef.current = null;
    }
    microphoneOpenedAtRef.current = null;
    if (demoPartialTimerRef.current !== null) {
      window.clearTimeout(demoPartialTimerRef.current);
      demoPartialTimerRef.current = null;
    }
    setConnection("idle");
    setUploading(false);
    setDeciding(false);
  }, []);

  const terminateLiveAttempt = useCallback((connectionState: ConnectionState = "idle") => {
    workGenerationRef.current += 1;
    stopRequestedRef.current = true;
    socketRef.current?.close();
    socketRef.current = null;
    void microphoneRef.current.stop().catch(() => undefined);
    if (finalTimerRef.current !== null) {
      window.clearTimeout(finalTimerRef.current);
      finalTimerRef.current = null;
    }
    if (responseTimerRef.current !== null) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
    if (captureDeadlineTimerRef.current !== null) {
      window.clearTimeout(captureDeadlineTimerRef.current);
      captureDeadlineTimerRef.current = null;
    }
    microphoneOpenedAtRef.current = null;
    setConnection(connectionState);
  }, []);

  const resetUtterance = useCallback(() => {
    const pendingCandidate = candidate;
    if (pendingCandidate && runtime === "live") {
      void submitDecision(
        pendingCandidate.utteranceId,
        pendingCandidate.detectedIntentId,
        "fallback",
      ).catch(() => undefined);
    }
    avatarExecutionRef.current = null;
    cancelActiveWork();
    setProvisional("");
    setFinalCaption("");
    setCandidate(null);
    setAsset(null);
    setFallbackReason("");
    setNotice("");
    setError("");
    setTypedMessage("");
    setProcessState("idle");
    setShowFeedback(false);
    setFeedbackSent(false);
    setPendingAvatarMessage(null);
    setAvatarRequest(null);
    finalReceivedRef.current = false;
    finalTranscriptRef.current = "";
  }, [cancelActiveWork, candidate, runtime]);

  const prepareAvatarMessage = useCallback((text: string, source: AvatarMessageSource) => {
    const normalized = text.trim();
    if (!normalized) {
      setPendingAvatarMessage(null);
      setAvatarRequest(null);
      setFallbackReason("empty_transcript");
      setProcessState("fallback");
      return;
    }
    setFinalCaption(normalized);
    setCandidate(null);
    setAsset(null);
    setPendingAvatarMessage(null);
    setAvatarRequest(null);
    setError("");
    if (mode !== "avatar_captions" || !avatarActivated) {
      setFallbackReason("captions_only_selected");
      setProcessState("fallback");
      setNotice("The final caption is ready. The experimental avatar was not activated, so no provider request was made.");
      return;
    }
    if (!avatarConfig?.enabled) {
      setFallbackReason("avatar_unavailable");
      setProcessState("fallback");
      setNotice("The experimental avatar is not configured. The English caption remains available.");
      return;
    }
    setFallbackReason("");
    setPendingAvatarMessage({ id: crypto.randomUUID(), text: normalized, source });
    setProcessState("avatar_confirmation");
    setNotice("Review the final caption. Nothing is sent to Hand Talk until staff confirms this message.");
  }, [avatarActivated, avatarConfig?.enabled, mode]);

  const handleAvatarStateChange = useCallback((next: AvatarPlaybackState) => {
    setAvatarState(next);
    const execution = avatarExecutionRef.current;
    if (!execution) return;
    const latencyMs = Math.min(
      120_000,
      Math.max(0, Math.round(performance.now() - execution.authorizedAt)),
    );
    if (next === "translating" && !execution.started) {
      execution.started = true;
      void reportAvatarExecution({
        authorizationId: execution.authorizationId,
        result: "started",
        latencyMs,
      }).catch(() => undefined);
      return;
    }
    if (next === "ready" && execution.started && !execution.terminal) {
      execution.terminal = true;
      void reportAvatarExecution({
        authorizationId: execution.authorizationId,
        result: "completed",
        latencyMs,
      }).catch(() => undefined);
      return;
    }
    if (next === "error" && !execution.terminal) {
      execution.terminal = true;
      void reportAvatarExecution({
        authorizationId: execution.authorizationId,
        result: "failed",
        latencyMs,
      }).catch(() => undefined);
    }
  }, []);

  const applyCandidate = useCallback((next: IntentCandidate, transcriptOverride?: string) => {
    const intent = next.intentId ? getIntent(next.intentId, catalog) : undefined;
    const enriched: IntentCandidate = {
      ...next,
      transcript: transcriptOverride ?? next.transcript,
      ...(intent ? { title: intent.title, description: intent.description } : {}),
    };
    setCandidate(enriched);
    setFinalCaption((current) => transcriptOverride ?? next.transcript ?? current);
    if (!enriched.supported) {
      setFallbackReason(enriched.reasonCode);
      setProcessState("fallback");
    } else if (mode !== "asl_captions") {
      setFallbackReason("captions_only_selected");
      setProcessState("fallback");
      setNotice("Captions-only mode is active. No signing video will be requested.");
    } else {
      setProcessState("candidate");
    }
  }, [catalog, mode]);

  const handleLiveEvent = useCallback((event: LiveCaptionEvent) => {
    if (event.type === "partial") {
      setProvisional(event.text ?? "");
      return;
    }
    if (event.type === "final") {
      finalReceivedRef.current = true;
      if (finalTimerRef.current !== null) {
        window.clearTimeout(finalTimerRef.current);
        finalTimerRef.current = null;
      }
      setProvisional("");
      if (event.text) {
        finalTranscriptRef.current = finalTranscriptRef.current
          ? `${finalTranscriptRef.current} ${event.text}`
          : event.text;
        setFinalCaption(finalTranscriptRef.current);
      }
      setProcessState((current) => current === "finalizing" || current === "classifying"
        ? mode === "asl_captions" ? "classifying" : "finalizing"
        : current);
      return;
    }
    if (event.type === "speech_end") {
      terminateLiveAttempt();
      if (!finalReceivedRef.current) return;
      if (mode === "avatar_captions") {
        prepareAvatarMessage(finalTranscriptRef.current, "speech");
      } else if (mode === "captions_only") {
        setFallbackReason("");
        setProcessState("caption_ready");
        setNotice("The final caption is ready. No phrase classifier or signing provider was invoked.");
      }
      return;
    }
    if (event.type === "candidate" && event.candidate) {
      terminateLiveAttempt();
      if (mode === "avatar_captions" && finalReceivedRef.current) {
        prepareAvatarMessage(finalTranscriptRef.current || event.text || "", "speech");
        return;
      }
      if (mode === "captions_only") {
        setFallbackReason("");
        setProcessState("caption_ready");
        setNotice("The final caption is ready. No signing request was made.");
        return;
      }
      applyCandidate(event.candidate, event.text);
      return;
    }
    if (event.type === "error") {
      terminateLiveAttempt("offline");
      setError(event.message ?? "Live transcription is unavailable.");
      setFallbackReason(event.code ?? "speech_service_error");
      setProcessState("fallback");
      return;
    }
    if (event.type === "fallback") {
      terminateLiveAttempt();
      if (mode === "avatar_captions" && finalReceivedRef.current) {
        prepareAvatarMessage(finalTranscriptRef.current, "speech");
        return;
      }
      setFallbackReason(event.code ?? "unknown_intent");
      setProcessState("fallback");
    }
  }, [applyCandidate, mode, prepareAvatarMessage, terminateLiveAttempt]);

  useEffect(() => {
    handleLiveEventRef.current = handleLiveEvent;
  }, [handleLiveEvent]);

  useEffect(() => {
    if (!session || runtime !== "live") return;
    let active = true;
    loadCatalog()
      .then((nextCatalog) => {
        if (!active) return;
        setCatalog({
          ...nextCatalog,
          intents: nextCatalog.intents.map((intent) => {
            const displayCopy = getIntent(intent.id, DEMO_CATALOG);
            return displayCopy ? { ...intent, title: displayCopy.title, caption: displayCopy.caption } : intent;
          }),
        });
        setCatalogMessage("");
      })
      .catch(() => {
        if (!active) return;
        setCatalog({ ...DEMO_CATALOG, version: "catalog-unavailable", intents: DEMO_CATALOG.intents.map((intent) => ({ ...intent, available: false })) });
        setCatalogMessage("The published phrase catalog is unavailable. Captions and typing still work.");
      });
    return () => {
      active = false;
    };
  }, [runtime, session]);

  useEffect(() => {
    if (!session) return;
    if (runtime === "demo" || mode !== "avatar_captions" || !avatarActivated) {
      setAvatarConfig(DISABLED_AVATAR_CONFIG);
      setAvatarState("unavailable");
      return;
    }
    let active = true;
    setAvatarConfig(null);
    setAvatarState("loading");
    loadAvatarConfig()
      .then((config) => {
        if (!active) return;
        setAvatarConfig(config);
        setAvatarState(config.enabled ? "loading" : "unavailable");
        setNotice(config.enabled
          ? "Experimental avatar access is available. Every final message still requires separate staff confirmation."
          : "The experimental avatar provider is not configured. Captions and reviewed phrases remain available.");
      })
      .catch(() => {
        if (!active) return;
        setAvatarConfig(DISABLED_AVATAR_CONFIG);
        setAvatarState("unavailable");
        setNotice("The experimental avatar configuration could not be loaded. Captions remain available.");
      });
    return () => {
      active = false;
    };
  }, [avatarActivated, mode, runtime, session]);

  useEffect(() => () => {
    workGenerationRef.current += 1;
    socketRef.current?.close();
    socketRef.current = null;
    void microphoneRef.current.stop().catch(() => undefined);
    if (finalTimerRef.current !== null) window.clearTimeout(finalTimerRef.current);
    if (responseTimerRef.current !== null) window.clearTimeout(responseTimerRef.current);
    if (captureDeadlineTimerRef.current !== null) window.clearTimeout(captureDeadlineTimerRef.current);
    if (demoPartialTimerRef.current !== null) window.clearTimeout(demoPartialTimerRef.current);
  }, []);

  useEffect(() => {
    if (processState === "candidate" || processState === "avatar_confirmation") confirmationRef.current?.focus();
  }, [processState]);

  useEffect(() => {
    if (processState !== "listening") return undefined;
    const startedAt = performance.now() - recordingSeconds * 1000;
    const timer = window.setInterval(() => {
      const elapsed = Math.min(15, (performance.now() - startedAt) / 1000);
      setRecordingSeconds(elapsed);
      if (elapsed >= 15) void stopCapture();
    }, 100);
    return () => window.clearInterval(timer);
    // stopCapture intentionally reads current refs and state; restarting this timer would risk duplicate stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processState]);

  async function startCapture(): Promise<void> {
    resetUtterance();
    const generation = workGenerationRef.current;
    stopRequestedRef.current = false;
    setRecordingSeconds(0);
    if (runtime === "demo") {
      setProcessState("listening");
      setNotice("Local demo: microphone audio is not captured or sent. The transcript below is scripted.");
      demoPartialTimerRef.current = window.setTimeout(() => {
        if (generation === workGenerationRef.current) setProvisional("Hello, welcome. How may…");
      }, 450);
      return;
    }
    if (!session) return;
    setProcessState("preparing");
    let socket: LiveTranscriptionSocket | null = null;
    let readyToSend = false;
    let connectionReady = false;
    try {
      let connectionError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        socket = new LiveTranscriptionSocket({
          sessionId: session.sessionId,
          siteId: session.siteId,
          consentVersion: session.consentVersion,
          outputLane: mode,
          onEvent: (event) => {
            if (generation === workGenerationRef.current) handleLiveEventRef.current(event);
          },
          onConnection: (state) => {
            if (generation === workGenerationRef.current) setConnection(state);
          },
        });
        socketRef.current = socket;
        try {
          await socket.connect();
          connectionError = null;
          break;
        } catch (error) {
          connectionError = error;
          socket.close();
          if (socketRef.current === socket) socketRef.current = null;
          if (generation !== workGenerationRef.current || isAbortError(error)) throw error;
          if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
      }
      if (connectionError || !socket) throw connectionError ?? new Error("Could not connect to live transcription.");
      connectionReady = true;
      if (generation !== workGenerationRef.current) {
        socket.close();
        return;
      }
      readyToSend = true;
      await microphoneRef.current.start((frame) => {
        if (!readyToSend || generation !== workGenerationRef.current) return;
        if (!socket?.sendAudio(frame) && !stopRequestedRef.current) {
          terminateLiveAttempt("offline");
          setError("Audio stopped because the speech connection was interrupted.");
          setFallbackReason("connection_lost");
          setProcessState("fallback");
        }
      }, () => {
        microphoneOpenedAtRef.current = performance.now();
        captureDeadlineTimerRef.current = window.setTimeout(() => {
          if (generation === workGenerationRef.current) void finalizeLiveCapture(generation);
        }, 15_000);
      });
      if (generation !== workGenerationRef.current) {
        socket.close();
        await microphoneRef.current.stop();
        return;
      }
      const openedAt = microphoneOpenedAtRef.current;
      setRecordingSeconds(openedAt === null ? 0 : Math.min(15, (performance.now() - openedAt) / 1_000));
      setProcessState("listening");
    } catch (captureError) {
      socket?.close();
      if (socketRef.current === socket) socketRef.current = null;
      await microphoneRef.current.stop().catch(() => undefined);
      if (generation !== workGenerationRef.current || isAbortError(captureError)) return;
      terminateLiveAttempt(connectionReady ? "idle" : "offline");
      setProcessState("fallback");
      setFallbackReason(connectionReady ? "microphone_unavailable" : "speech_connection_unavailable");
      setError(captureError instanceof Error
        ? captureError.message
        : connectionReady ? "Microphone access was not available." : "Live transcription could not connect.");
    }
  }

  async function finalizeLiveCapture(generation: number): Promise<void> {
    if (generation !== workGenerationRef.current || stopRequestedRef.current) return;
    stopRequestedRef.current = true;
    if (captureDeadlineTimerRef.current !== null) {
      window.clearTimeout(captureDeadlineTimerRef.current);
      captureDeadlineTimerRef.current = null;
    }
    setProcessState("finalizing");
    await microphoneRef.current.stop({ flush: true });
    if (generation !== workGenerationRef.current) return;
    if (!socketRef.current?.endUtterance()) {
      terminateLiveAttempt("offline");
      setError("The speech connection ended before the message could be finalized.");
      setFallbackReason("connection_lost");
      setProcessState("fallback");
      return;
    }
    responseTimerRef.current = window.setTimeout(() => {
      if (generation !== workGenerationRef.current) return;
      terminateLiveAttempt();
      if (mode === "avatar_captions" && finalTranscriptRef.current) {
        prepareAvatarMessage(finalTranscriptRef.current, "speech");
        return;
      }
      if (mode === "captions_only" && finalTranscriptRef.current) {
        setFallbackReason("");
        setProcessState("caption_ready");
        setNotice("The finalized caption is ready. The speech-end acknowledgement timed out, but no phrase classification was requested.");
        return;
      }
      setFallbackReason("classification_timeout");
      setProcessState("fallback");
      setNotice("The finalized caption remains available, but phrase selection timed out. Use captions or try again.");
    }, 5_000);
    finalTimerRef.current = window.setTimeout(() => {
      if (generation !== workGenerationRef.current || finalReceivedRef.current) return;
      terminateLiveAttempt();
      setProvisional("");
      setFallbackReason("no_final_transcript");
      setProcessState("fallback");
      setNotice("The provisional words were discarded and were not sent for intent selection.");
    }, 1_200);
  }

  async function stopCapture(): Promise<void> {
    if (processState !== "listening" || stopRequestedRef.current) return;
    const generation = workGenerationRef.current;
    if (demoPartialTimerRef.current !== null) {
      window.clearTimeout(demoPartialTimerRef.current);
      demoPartialTimerRef.current = null;
    }
    if (runtime === "demo") {
      stopRequestedRef.current = true;
      setProcessState("finalizing");
      setProvisional("");
      setFinalCaption(DEMO_TRANSCRIPT);
      demoPartialTimerRef.current = window.setTimeout(() => {
        if (generation !== workGenerationRef.current) return;
        if (mode === "avatar_captions") prepareAvatarMessage(DEMO_TRANSCRIPT, "speech");
        else if (mode === "asl_captions") applyCandidate(classifyDemoTranscript(DEMO_TRANSCRIPT));
        else {
          setFallbackReason("");
          setProcessState("caption_ready");
          setNotice("Local demo caption ready. No classifier or signing provider was invoked.");
        }
      }, 500);
      return;
    }
    await finalizeLiveCapture(generation);
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    resetUtterance();
    const generation = workGenerationRef.current;
    const validation = validateAudioFile(file);
    if (validation) {
      setError(validation);
      setProcessState("fallback");
      return;
    }
    setUploading(true);
    setProcessState("finalizing");
    const durationError = await validateAudioDuration(file);
    if (generation !== workGenerationRef.current) return;
    if (durationError) {
      setError(durationError);
      setProcessState("fallback");
      setUploading(false);
      return;
    }
    if (runtime === "demo") {
      setNotice("Local demo: this file was validated in your browser but its audio was not transcribed or uploaded.");
      demoPartialTimerRef.current = window.setTimeout(() => {
        if (generation !== workGenerationRef.current) return;
        setFinalCaption("Please wait here.");
        if (mode === "avatar_captions") prepareAvatarMessage("Please wait here.", "upload");
        else if (mode === "asl_captions") applyCandidate(classifyDemoTranscript("Please wait here."));
        else {
          setFallbackReason("");
          setProcessState("caption_ready");
          setNotice("Local demo caption ready. No classifier or signing provider was invoked.");
        }
        setUploading(false);
      }, 700);
      return;
    }
    try {
      const result = await transcribeAudio(file, mode);
      if (generation !== workGenerationRef.current) return;
      setFinalCaption(result.transcript);
      if (mode === "avatar_captions") {
        prepareAvatarMessage(result.transcript, "upload");
      } else if (mode === "captions_only") {
        setFallbackReason("");
        setProcessState("caption_ready");
        setNotice("The final caption is ready. No phrase classifier or signing provider was invoked.");
      } else if (result.candidate) {
        applyCandidate(result.candidate, result.transcript);
      } else {
        setError("The reviewed-phrase lane did not return an intent decision. Keep the English caption visible.");
        setFallbackReason("model_unavailable");
        setProcessState("fallback");
      }
    } catch (uploadError) {
      if (generation !== workGenerationRef.current) return;
      setError(formatError(uploadError));
      setFallbackReason(uploadError instanceof ApiError ? uploadError.code ?? "transcription_error" : "transcription_error");
      setProcessState("fallback");
    } finally {
      if (generation === workGenerationRef.current) setUploading(false);
    }
  }

  function submitTyped(event: FormEvent): void {
    event.preventDefault();
    const text = typedMessage.trim();
    if (!text) return;
    resetUtterance();
    setFinalCaption(text);
    if (mode === "avatar_captions") {
      prepareAvatarMessage(text, "type");
    } else if (mode === "captions_only") {
      const safety = runAvatarSafetyGate({ text, locale: "en-US", isFinal: true });
      setCandidate(null);
      if (!safety.allowed && safety.reasonCode === "high_stakes_content") {
        setFallbackReason("high_stakes_content");
        setProcessState("fallback");
        setNotice("This may be consequential communication. Keep the English caption visible and use qualified support.");
      } else {
        setFallbackReason("");
        setProcessState("caption_ready");
        setNotice("The final caption is ready. No phrase classifier or signing provider was invoked.");
      }
    } else if (runtime === "demo") {
      applyCandidate(classifyDemoTranscript(text), text);
      setNotice("Local demo classifier: deterministic browser rules only; Gemini was not called.");
    } else {
      setCandidate(null);
      setFallbackReason("typed_caption");
      setProcessState("fallback");
      setNotice("Typed messages remain captions in the reviewed-phrase lane. Choose a published phrase or use finalized speech.");
    }
  }

  function showManualPhrase(): void {
    const intent = getIntent(selectedPhrase, catalog);
    if (!intent) return;
    resetUtterance();
    if (mode === "avatar_captions") {
      prepareAvatarMessage(intent.caption, "phrase");
      return;
    }
    setFinalCaption(intent.caption);
    setFallbackReason("manual_caption");
    setProcessState("fallback");
    setNotice(runtime === "demo"
      ? "Local demo: selected from an illustrative catalog. No cloud avatar or reviewed ASL asset was requested."
      : "Selected from the published phrase list. This fallback displays the English caption only.");
  }

  function activateAvatarMode(): void {
    if (mode !== "avatar_captions" || !avatarActivationAcknowledged) return;
    setAvatarActivated(true);
    setAvatarConfig(null);
    setAvatarState("loading");
    setNotice("Checking the contracted avatar provider. No message text has been sent.");
  }

  function selectExperienceMode(nextMode: ExperienceMode): void {
    if (nextMode === mode) return;
    setMode(nextMode);
    setAvatarActivationAcknowledged(false);
    setAvatarActivated(false);
    setAvatarConfig(DISABLED_AVATAR_CONFIG);
    setAvatarState("unavailable");
    cancelActiveWork();
    videoRef.current?.pause();
    avatarExecutionRef.current = null;
    void avatarRef.current?.stop().catch(() => undefined);
    setAsset(null);
    setPendingAvatarMessage(null);
    setAvatarRequest(null);
    if (candidate && runtime === "live") {
      void submitDecision(candidate.utteranceId, candidate.detectedIntentId, "fallback").catch(
        () => undefined,
      );
    }
    setCandidate(null);
    if (finalCaption || processState === "candidate" || processState === "avatar_confirmation" || processState === "playing") {
      setFallbackReason(nextMode === "captions_only" ? "captions_only_selected" : "staff_rejected");
      setProcessState("fallback");
    }
    setNotice(nextMode === "captions_only"
      ? "Captions-only mode is active. No signing video will be requested."
      : nextMode === "asl_captions"
        ? "Reviewed ASL mode is active. Only a supported published phrase can be offered for staff approval."
        : "Before using the experimental avatar, record the visitor’s choice and activate provider access below.");
  }

  async function decide(decision: "play" | "fallback"): Promise<void> {
    if (!candidate) return;
    const generation = workGenerationRef.current;
    const effectiveDecision = mode === "asl_captions" ? decision : "fallback";
    setDeciding(true);
    setError("");
    if (runtime === "demo") {
      setCandidate(null);
      setFallbackReason(effectiveDecision === "play" ? "demo_asset_blocked" : "staff_rejected");
      setProcessState("fallback");
      setNotice(effectiveDecision === "play"
        ? "Demo boundary reached: no cloud service or Deaf-reviewed signing asset was requested. Connect a verified published catalog to enable playback."
        : "Staff chose captions only. No signing asset was requested.");
      setDeciding(false);
      return;
    }
    try {
      const playback = await submitDecision(
        candidate.utteranceId,
        candidate.detectedIntentId,
        effectiveDecision,
      );
      if (generation !== workGenerationRef.current) return;
      if (effectiveDecision === "fallback" || !playback) {
        setCandidate(null);
        setFallbackReason("staff_rejected");
        setProcessState("fallback");
      } else {
        setAsset(playback);
        setCandidate(null);
        setFinalCaption(playback.caption || finalCaption);
        setProcessState("playing");
      }
    } catch (decisionError) {
      if (generation !== workGenerationRef.current) return;
      setCandidate(null);
      setError(formatError(decisionError));
      setFallbackReason(decisionError instanceof ApiError ? decisionError.code ?? "asset_unavailable" : "asset_unavailable");
      setProcessState("fallback");
    } finally {
      if (generation === workGenerationRef.current) setDeciding(false);
    }
  }

  async function decideAvatar(confirm: boolean): Promise<void> {
    const pending = pendingAvatarMessage;
    if (!pending) return;
    if (!confirm) {
      setPendingAvatarMessage(null);
      setAvatarRequest(null);
      setFallbackReason("staff_rejected");
      setProcessState("fallback");
      setNotice("Staff kept the English caption only. Nothing was sent to Hand Talk.");
      return;
    }

    const generation = workGenerationRef.current;
    setDeciding(true);
    setError("");
    try {
      const authorization = await authorizeAvatar(pending.text, pending.source);
      if (generation !== workGenerationRef.current) return;
      if (!authorization.allowed) {
        setPendingAvatarMessage(null);
        setAvatarRequest(null);
        setFallbackReason(authorization.reasonCode);
        setProcessState("fallback");
        setNotice("Safety checks kept this message as captions only. Nothing was sent to Hand Talk.");
        return;
      }
      setPendingAvatarMessage(null);
      setFallbackReason("");
      avatarExecutionRef.current = {
        authorizationId: authorization.authorizationId,
        authorizedAt: performance.now(),
        started: false,
        terminal: false,
      };
      setAvatarRequest({ id: authorization.authorizationId, text: authorization.text });
      setProcessState("playing");
      setNotice("Staff confirmed this message. The finalized caption remains visible while the experimental avatar signs.");
    } catch (authorizationError) {
      if (generation !== workGenerationRef.current) return;
      setPendingAvatarMessage(null);
      setAvatarRequest(null);
      avatarExecutionRef.current = null;
      setError(formatError(authorizationError));
      setFallbackReason(authorizationError instanceof ApiError ? authorizationError.code ?? "avatar_error" : "avatar_error");
      setProcessState("fallback");
    } finally {
      if (generation === workGenerationRef.current) setDeciding(false);
    }
  }

  async function signOut(): Promise<void> {
    resetUtterance();
    if (runtime === "live") await endSession().catch(() => undefined);
    setMode("captions_only");
    setAvatarActivationAcknowledged(false);
    setAvatarActivated(false);
    setAvatarConfig(DISABLED_AVATAR_CONFIG);
    setAvatarState("unavailable");
    setSession(null);
    setView("reception");
  }

  async function openMetrics(): Promise<void> {
    resetUtterance();
    setView("metrics");
    setMetricsError("");
    if (runtime === "demo") {
      setMetrics(DEMO_METRICS);
      return;
    }
    setMetrics(null);
    try {
      setMetrics(await loadMetrics());
    } catch (metricsLoadError) {
      setMetricsError(formatError(metricsLoadError));
    }
  }

  const interactionLocked = processState === "preparing"
    || processState === "listening"
    || processState === "finalizing"
    || processState === "classifying"
    || uploading
    || deciding;

  if (!session) {
    return <AccessGate onSession={(nextSession, nextRuntime) => {
      setSession(nextSession);
      setRuntime(nextRuntime);
      setMode("captions_only");
      setConnection("idle");
      setCatalog(nextRuntime === "demo" ? DEMO_CATALOG : { ...DEMO_CATALOG, intents: [] });
      setAvatarActivationAcknowledged(false);
      setAvatarActivated(false);
      setAvatarConfig(DISABLED_AVATAR_CONFIG);
      setAvatarState("unavailable");
    }} />;
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <AppHeader
        runtime={runtime}
        connection={connection}
        view={view}
        onReception={() => setView("reception")}
        onMetrics={() => void openMetrics()}
        onSignOut={() => void signOut()}
      />

      {runtime === "demo" ? (
        <div className="demo-ribbon" role="status">
          <Icon name="flask" />
          <strong>Local product demo</strong>
          <span>Scripted transcript and browser-only rules. No Cloud Speech, Gemini, Hand Talk, Firestore, or reviewed ASL assets.</span>
        </div>
      ) : null}

      <main id="main-content">
        {view === "metrics" ? (
          <MetricsView metrics={metrics} error={metricsError} isDemo={runtime === "demo"} onBack={() => setView("reception")} />
        ) : (
          <div className="workspace">
            <section className="operator-column" aria-label="Staff controls">
              <div className="eyebrow-row">
                <p className="eyebrow">Staff controls</p>
                <span className="privacy-chip"><Icon name="shield" /> Audio is not retained</span>
              </div>
              <h1>Help every visitor feel understood.</h1>
              <p className="lede">English captions are the default. Staff may separately choose a reviewed phrase or confirm one experimental avatar message.</p>

              <div className="scope-note">
                <Icon name="info" />
                <div>
                  <strong>Signing is always opt-in</strong>
                  <p>Reviewed clips and the experimental avatar are separate modes. Avatar text is sent only after per-message staff confirmation. Never use automatic ASL for emergencies, health, legal, security, payment, identity, or employment matters.</p>
                </div>
              </div>

              <fieldset className="mode-fieldset">
                <legend>Visitor display</legend>
                <div className="segmented-control">
                  <label className={mode === "captions_only" ? "selected" : ""}>
                    <input
                      type="radio"
                      name="experience-mode"
                      value="captions_only"
                      checked={mode === "captions_only"}
                      disabled={interactionLocked}
                      onChange={() => selectExperienceMode("captions_only")}
                    />
                    <Icon name="captions" />
                    <span><strong>Captions only</strong><small>Default · no signing request</small></span>
                  </label>
                  <label className={mode === "asl_captions" ? "selected" : ""}>
                    <input
                      type="radio"
                      name="experience-mode"
                      value="asl_captions"
                      checked={mode === "asl_captions"}
                      disabled={interactionLocked}
                      onChange={() => selectExperienceMode("asl_captions")}
                    />
                    <Icon name="hands" />
                    <span><strong>Reviewed ASL + captions</strong><small>Published phrases · staff approval</small></span>
                  </label>
                  <label className={mode === "avatar_captions" ? "selected" : ""}>
                    <input
                      type="radio"
                      name="experience-mode"
                      value="avatar_captions"
                      checked={mode === "avatar_captions"}
                      disabled={interactionLocked}
                      onChange={() => selectExperienceMode("avatar_captions")}
                    />
                    <Icon name="spark" />
                    <span><strong>Experimental avatar + captions</strong><small>{!avatarActivated ? "Activation required" : avatarConfig === null ? "Checking provider" : avatarConfig.enabled ? "Confirm every message" : "Provider not configured"}</small></span>
                  </label>
                </div>
              </fieldset>

              {mode === "avatar_captions" ? (
                <section className="avatar-activation" aria-labelledby="avatar-activation-title">
                  <div>
                    <p className="step-label">Experimental provider activation</p>
                    <h2 id="avatar-activation-title">Confirm the visitor chose avatar signing</h2>
                  </div>
                  <label>
                    <input
                      type="checkbox"
                      checked={avatarActivationAcknowledged}
                      disabled={avatarActivated || interactionLocked}
                      onChange={(event) => setAvatarActivationAcknowledged(event.target.checked)}
                    />
                    <span>The visitor chose the experimental avatar. I understand finalized text goes to Hand Talk only after I confirm each message, and its output may be wrong and is not interpretation.</span>
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!avatarActivationAcknowledged || avatarActivated || interactionLocked}
                    onClick={activateAvatarMode}
                  >
                    <Icon name="shield" /> {avatarActivated ? "Experimental avatar enabled" : "Enable experimental avatar"}
                  </button>
                  {avatarActivated ? (
                    <p className="microcopy" role="status">
                      {avatarConfig === null
                        ? "Checking provider configuration… No message text has been sent."
                        : avatarConfig.enabled
                          ? avatarState === "ready"
                            ? "Provider ready. Each message still requires separate confirmation."
                            : avatarState === "error"
                              ? "Provider initialization failed. Continue with captions."
                              : "Initializing the avatar provider… No message text has been sent."
                          : "Provider unavailable. Continue with captions or reviewed ASL phrases."}
                    </p>
                  ) : null}
                </section>
              ) : null}

              <section className="input-card" aria-labelledby="input-heading">
                <div className="card-heading">
                  <div>
                    <p className="step-label">Step 1</p>
                    <h2 id="input-heading">Create the message</h2>
                  </div>
                  {processState === "caption_ready" || processState === "candidate" || processState === "avatar_confirmation" || processState === "fallback" || processState === "playing" ? <button className="text-button" type="button" onClick={resetUtterance}>Clear</button> : null}
                </div>

                <div className="input-tabs" aria-label="Message input method">
                  {INPUT_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      id={`tab-${tab.id}`}
                      type="button"
                      aria-pressed={inputMethod === tab.id}
                      aria-controls={inputMethod === tab.id ? `panel-${tab.id}` : undefined}
                      disabled={interactionLocked}
                      onClick={() => setInputMethod(tab.id)}
                    >
                      <Icon name={tab.id} />
                      <span>{tab.label}<small>{tab.detail}</small></span>
                    </button>
                  ))}
                </div>

                <div className="input-panel" id={`panel-${inputMethod}`} role="region" aria-labelledby={`tab-${inputMethod}`}>
                  {inputMethod === "speak" ? (
                    <SpeakPanel
                      preparing={processState === "preparing"}
                      listening={processState === "listening"}
                      busy={processState === "finalizing" || processState === "classifying"}
                      seconds={recordingSeconds}
                      connection={connection}
                      runtime={runtime}
                      onStart={() => void startCapture()}
                      onStop={() => void stopCapture()}
                    />
                  ) : null}
                  {inputMethod === "upload" ? <UploadPanel uploading={uploading} onChange={(event) => void handleUpload(event)} /> : null}
                  {inputMethod === "type" ? (
                    <TypePanel
                      value={typedMessage}
                      submitLabel={mode === "avatar_captions" ? "Prepare avatar & caption" : "Show caption"}
                      onChange={setTypedMessage}
                      onSubmit={submitTyped}
                    />
                  ) : null}
                  {inputMethod === "phrases" ? (
                    <PhrasePanel catalog={catalog} value={selectedPhrase} message={catalogMessage} onChange={setSelectedPhrase} onSubmit={showManualPhrase} />
                  ) : null}
                </div>
              </section>

              <CommunicationFallback />
            </section>

            <section className="display-column" aria-label="Visitor display preview">
              <div className="display-header">
                <div>
                  <p className="eyebrow">Visitor display</p>
                  <h2>Conversation</h2>
                </div>
                <StateBadge state={processState} />
              </div>

              <div className={`visitor-stage ${asset ? "has-video" : ""} ${avatarConfig?.enabled && mode === "avatar_captions" && avatarActivated ? "has-avatar" : ""}`}>
                {avatarConfig?.enabled && mode === "avatar_captions" && avatarActivated ? (
                  <AvatarStage
                    ref={avatarRef}
                    config={avatarConfig}
                    request={avatarRequest}
                    caption={finalCaption}
                    state={avatarState}
                    onStateChange={(next) => {
                      handleAvatarStateChange(next);
                      if (next === "translating") setProcessState("playing");
                    }}
                    onError={(message) => {
                      setAvatarRequest(null);
                      setError(message);
                      setFallbackReason("avatar_error");
                      setProcessState("fallback");
                    }}
                  />
                ) : asset ? (
                  <VideoStage
                    ref={videoRef}
                    asset={asset}
                    caption={finalCaption}
                    onStarted={() => void reportPlayback({ utteranceId: asset.utteranceId, assetId: asset.assetId, result: "started" }).catch(() => undefined)}
                    onEnded={() => {
                      void reportPlayback({ utteranceId: asset.utteranceId, assetId: asset.assetId, result: "completed" }).catch(() => undefined);
                      setNotice("Signing video complete. The caption remains visible.");
                    }}
                    onFailed={() => {
                      void reportPlayback({ utteranceId: asset.utteranceId, assetId: asset.assetId, result: "failed" }).catch(() => undefined);
                      setAsset(null);
                      setError("The signing video could not play. The English caption remains available.");
                      setFallbackReason("playback_failure");
                      setProcessState("fallback");
                    }}
                  />
                ) : (
                  <CaptionStage
                    provisional={provisional}
                    finalCaption={finalCaption}
                    state={processState}
                    runtime={runtime}
                  />
                )}
              </div>

              {candidate?.supported && processState === "candidate" ? (
                <ConfirmationCard focusRef={confirmationRef} candidate={candidate} deciding={deciding} onDecision={(next) => void decide(next)} />
              ) : null}

              {pendingAvatarMessage && processState === "avatar_confirmation" ? (
                <AvatarConfirmationCard
                  focusRef={confirmationRef}
                  message={pendingAvatarMessage}
                  deciding={deciding}
                  onDecision={(confirm) => void decideAvatar(confirm)}
                />
              ) : null}

              {processState === "fallback" ? (
                <FallbackCard reason={fallbackReason} error={error} onType={() => setInputMethod("type")} onSupport={() => setNotice("Ask the visitor which communication support they prefer. For urgent danger, follow your emergency procedure.")} />
              ) : null}

              {notice ? <div className="notice" role="status"><Icon name="info" /><span>{notice}</span></div> : null}
              {error && processState !== "fallback" ? <div className="error-message" role="alert">{error}</div> : null}

              {asset || avatarRequest ? (
                <FeedbackPanel
                  open={showFeedback}
                  sent={feedbackSent}
                  onToggle={() => setShowFeedback((current) => !current)}
                  onSend={async (category, severity) => {
                    if (!candidate && !asset && !avatarRequest) return;
                    try {
                      await sendFeedback({
                        sessionId: session.sessionId,
                        ...(asset
                          ? { utteranceId: asset.utteranceId, assetId: asset.assetId }
                          : avatarRequest ? { utteranceId: avatarRequest.id } : {}),
                        reporterRole: "staff",
                        issueCategory: category,
                        severity,
                      });
                      setFeedbackSent(true);
                      setShowFeedback(false);
                    } catch (feedbackError) {
                      setError(formatError(feedbackError));
                    }
                  }}
                />
              ) : null}
            </section>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <span>SignBridge Reception</span>
        <span>Captions default · reviewed phrases and avatar are opt-in</span>
        <span>Experimental output is unverified and does not replace a qualified interpreter</span>
      </footer>
    </div>
  );
}

function AccessGate({ onSession }: { onSession: (session: SessionInfo, runtime: RuntimeMode) => void }): ReactNode {
  const [code, setCode] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!consent) return;
    setBusy(true);
    setError("");
    try {
      onSession(await exchangeSession(code.trim()), "live");
    } catch (loginError) {
      setError(formatError(loginError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="access-page" id="main-content">
      <section className="access-story" aria-labelledby="welcome-title">
        <BrandMark />
        <div className="story-copy">
          <p className="eyebrow">A more welcoming front desk</p>
          <h1 id="welcome-title">Make the first conversation accessible.</h1>
          <p>SignBridge keeps finalized English visible, with separate opt-in lanes for reviewed ASL phrases and an experimental 3D avatar.</p>
        </div>
        <div className="scope-grid">
          <div><Icon name="captions" /><strong>Captions by default</strong><span>Every final message stays visible.</span></div>
          <div><Icon name="hands" /><strong>Reviewed phrase lane</strong><span>Published clips still require staff approval.</span></div>
          <div><Icon name="shield" /><strong>Avatar confirmation</strong><span>Nothing is sent to the provider until staff confirms that message.</span></div>
        </div>
        <p className="access-disclaimer">Automatic avatar output is experimental, may be wrong, and is not certified interpretation. Use qualified support for consequential communication.</p>
      </section>

      <section className="access-panel" aria-labelledby="access-title">
        <div className="access-card">
          <p className="eyebrow">Staff access</p>
          <h2 id="access-title">Open your reception desk</h2>
          <p>Use the access code supplied to your pilot location.</p>
          <form onSubmit={(event) => void submit(event)}>
            <label htmlFor="access-code">Site access code</label>
            <div className="code-field">
              <Icon name="key" />
              <input
                id="access-code"
                type="password"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="current-password"
                required
                minLength={8}
                placeholder="Enter access code"
              />
            </div>
            <label className="consent-check">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span>I will tell the visitor before starting the microphone. I understand captions are the default and every experimental avatar message requires separate staff confirmation.</span>
            </label>
            <button className="primary-button wide" type="submit" disabled={!consent || !code.trim() || busy}>
              {busy ? <><span className="spinner" aria-hidden="true" /> Checking code…</> : <>Open reception <Icon name="arrow" /></>}
            </button>
          </form>
          {error ? <p className="error-message" role="alert">{error}</p> : null}
          <div className="demo-entry">
            <span>Evaluating the product?</span>
            <button
              type="button"
              className="secondary-button wide"
              onClick={() => onSession({
                sessionId: "local-demo-session",
                siteId: "local-demo",
                expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
                consentVersion: CURRENT_CONSENT_VERSION,
              }, "demo")}
            >
              <Icon name="flask" /> Explore local demo
            </button>
            <small>Clearly labeled caption simulation. No cloud service or avatar provider is called.</small>
          </div>
        </div>
      </section>
    </main>
  );
}

function AppHeader(props: {
  runtime: RuntimeMode;
  connection: ConnectionState;
  view: "reception" | "metrics";
  onReception: () => void;
  onMetrics: () => void;
  onSignOut: () => void;
}): ReactNode {
  return (
    <header className="app-header">
      <BrandMark compact />
      <nav aria-label="Primary navigation">
        <button type="button" className={props.view === "reception" ? "active" : ""} onClick={props.onReception}>Reception</button>
        <button type="button" className={props.view === "metrics" ? "active" : ""} onClick={props.onMetrics}>Pilot metrics</button>
      </nav>
      <div className="header-actions">
        <span className={`connection-badge ${props.runtime === "demo" ? "demo" : props.connection}`}>
          <span className="status-dot" />
          {props.runtime === "demo" ? "Local demo" : connectionLabel(props.connection)}
        </span>
        <button type="button" className="icon-button" onClick={props.onSignOut} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
      </div>
    </header>
  );
}

function SpeakPanel(props: {
  preparing: boolean;
  listening: boolean;
  busy: boolean;
  seconds: number;
  connection: ConnectionState;
  runtime: RuntimeMode;
  onStart: () => void;
  onStop: () => void;
}): ReactNode {
  const remaining = Math.max(0, 15 - props.seconds);
  return (
    <div className="speak-panel">
      <div className={`mic-orbit ${props.listening ? "active" : ""}`} aria-hidden="true"><Icon name={props.listening ? "stop" : "microphone"} /></div>
      <div>
        <h3>{props.preparing ? "Preparing the microphone…" : props.listening ? "Listening…" : props.busy ? "Finishing the caption…" : "Ready when you are"}</h3>
        <p>{props.preparing ? "Approve microphone access if your browser asks." : props.listening ? `Up to ${Math.ceil(remaining)} seconds remaining` : "Tell the visitor before you start. Release ends the message."}</p>
      </div>
      {props.listening ? (
        <button className="stop-button" type="button" onClick={props.onStop}><Icon name="stop" /> Stop & finalize</button>
      ) : (
        <button className="primary-button" type="button" onClick={props.onStart} disabled={props.preparing || props.busy || (props.runtime === "live" && props.connection === "connecting")}>
          <Icon name="microphone" /> Start microphone
        </button>
      )}
      <div className="recording-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, props.seconds / 15 * 100)}%` }} /></div>
      <p className="microcopy">16 kHz mono · 15-second maximum · microphone closes after each message</p>
    </div>
  );
}

function UploadPanel({ uploading, onChange }: { uploading: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void }): ReactNode {
  const [authorized, setAuthorized] = useState(false);
  function chooseFile(event: ChangeEvent<HTMLInputElement>): void {
    onChange(event);
    setAuthorized(false);
  }
  return (
    <div className="upload-panel">
      <label className="upload-consent">
        <input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} disabled={uploading} />
        <span>I am authorized to process this recording, and everyone recorded has been informed.</span>
      </label>
      <label className={`drop-zone ${uploading ? "busy" : ""} ${!authorized ? "disabled" : ""}`}>
        <Icon name="upload" />
        <strong>{uploading ? "Processing audio…" : authorized ? "Choose an audio recording" : "Confirm authorization to choose a file"}</strong>
        <span>WAV, MP3, or WebM · up to 60 seconds · 10 MB maximum</span>
        <input type="file" accept=".wav,.mp3,.webm,audio/wav,audio/mpeg,audio/webm" onChange={chooseFile} disabled={uploading || !authorized} />
      </label>
      <p className="microcopy"><Icon name="shield" /> Processed in memory and discarded. The file name is not stored.</p>
    </div>
  );
}

function TypePanel(props: { value: string; submitLabel: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void }): ReactNode {
  const maxLength = 1_000;
  return (
    <form className="type-panel" onSubmit={props.onSubmit}>
      <label htmlFor="typed-message">Message for the visitor</label>
      <textarea
        id="typed-message"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        maxLength={maxLength}
        rows={4}
        placeholder="Type clear English for the caption and experimental avatar…"
      />
      <div className="form-row"><span>{props.value.length}/{maxLength}</span><button className="primary-button" disabled={!props.value.trim()} type="submit"><Icon name={props.submitLabel.startsWith("Prepare") ? "hands" : "captions"} /> {props.submitLabel}</button></div>
    </form>
  );
}

function PhrasePanel(props: { catalog: PublicCatalog; value: string; message: string; onChange: (value: string) => void; onSubmit: () => void }): ReactNode {
  return (
    <div className="phrase-panel">
      <label htmlFor="phrase-select">Published reception phrase</label>
      <select id="phrase-select" value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        <option value="">Choose a phrase…</option>
        {props.catalog.intents.map((intent) => <option key={intent.id} value={intent.id} disabled={!intent.available}>{intent.title}{!intent.available ? " — unavailable" : ""}</option>)}
      </select>
      {props.value ? <p className="phrase-preview">“{getIntent(props.value, props.catalog)?.caption}”</p> : null}
      {props.message ? <p className="inline-warning" role="status">{props.message}</p> : null}
      <button className="primary-button" type="button" disabled={!props.value} onClick={props.onSubmit}><Icon name="captions" /> Show selected caption</button>
    </div>
  );
}

function CaptionStage(props: { provisional: string; finalCaption: string; state: ProcessState; runtime: RuntimeMode }): ReactNode {
  if (!props.provisional && !props.finalCaption) {
    return (
      <div className="empty-stage">
        <div className="empty-illustration" aria-hidden="true"><span /><span /><span /></div>
        <h3>The visitor’s caption will appear here</h3>
        <p>Final captions are announced once and remain on screen.</p>
      </div>
    );
  }
  return (
    <div className="caption-stage">
      {props.runtime === "demo" ? <span className="stage-watermark">Simulated · local demo</span> : null}
      {props.provisional ? (
        <div className="provisional-caption" aria-hidden="true">
          <span>Provisional</span>
          <p>{props.provisional}</p>
        </div>
      ) : null}
      {props.finalCaption ? (
        <div className="final-caption">
          <span>English caption · final</span>
          <p aria-live="polite" aria-atomic="true">{props.finalCaption}</p>
        </div>
      ) : null}
      {props.state === "finalizing" || props.state === "classifying" ? (
        <div className="processing-line" role="status"><span className="spinner" aria-hidden="true" /> {props.state === "finalizing" ? "Waiting for a final transcript" : "Checking the bounded phrase catalog"}</div>
      ) : null}
    </div>
  );
}

function ConfirmationCard({ focusRef, candidate, deciding, onDecision }: { focusRef: RefObject<HTMLElement | null>; candidate: IntentCandidate; deciding: boolean; onDecision: (decision: "play" | "fallback") => void }): ReactNode {
  return (
    <section ref={focusRef} tabIndex={-1} className="confirmation-card" aria-labelledby="confirm-title">
      <div className="confirmation-icon"><Icon name="check" /></div>
      <div className="confirmation-copy">
        <p className="step-label">Step 2 · Staff review required</p>
        <h3 id="confirm-title">Does this phrase match your meaning?</h3>
        <div className="intent-choice"><strong>{candidate.title ?? candidate.intentId?.replaceAll("_", " ")}</strong><span>{candidate.description}</span></div>
        <p className="safety-copy">Approve only when the bounded phrase is an accurate fit. A candidate is never played automatically.</p>
        <div className="button-row">
          <button className="primary-button" type="button" disabled={deciding} onClick={() => onDecision("play")}><Icon name="play" /> Approve ASL phrase</button>
          <button className="secondary-button" type="button" disabled={deciding} onClick={() => onDecision("fallback")}>Use captions only</button>
        </div>
      </div>
    </section>
  );
}

function AvatarConfirmationCard({
  focusRef,
  message,
  deciding,
  onDecision,
}: {
  focusRef: RefObject<HTMLElement | null>;
  message: PendingAvatarMessage;
  deciding: boolean;
  onDecision: (confirm: boolean) => void;
}): ReactNode {
  return (
    <section ref={focusRef} tabIndex={-1} className="confirmation-card avatar-confirmation-card" aria-labelledby="avatar-confirm-title">
      <div className="confirmation-icon"><Icon name="shield" /></div>
      <div className="confirmation-copy">
        <p className="step-label">Step 2 · Per-message confirmation required</p>
        <h3 id="avatar-confirm-title">Send this caption to the experimental avatar?</h3>
        <div className="intent-choice"><strong>Final English caption</strong><span>{message.text}</span></div>
        <p className="safety-copy">Nothing has been sent to Hand Talk. Confirm only for routine, non-consequential communication; automatic ASL may be wrong or incomplete.</p>
        <div className="button-row">
          <button className="primary-button" type="button" disabled={deciding} onClick={() => onDecision(true)}><Icon name="play" /> Confirm avatar message</button>
          <button className="secondary-button" type="button" disabled={deciding} onClick={() => onDecision(false)}>Keep captions only</button>
        </div>
      </div>
    </section>
  );
}

function FallbackCard(props: { reason: string; error: string; onType: () => void; onSupport: () => void }): ReactNode {
  const copy = props.error || FALLBACK_COPY[props.reason] || "A signing phrase was not selected. Keep the English caption visible or use another communication option.";
  return (
    <section className="fallback-card" aria-labelledby="fallback-title">
      <div className="fallback-icon"><Icon name="route" /></div>
      <div>
        <p className="step-label">Safe fallback</p>
        <h3 id="fallback-title">Continue another way</h3>
        <p>{copy}</p>
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={props.onType}><Icon name="type" /> Type a message</button>
          <button className="text-button" type="button" onClick={props.onSupport}>Communication support</button>
        </div>
      </div>
    </section>
  );
}

const AvatarStage = forwardRef<HandTalkAvatarHandle, {
  config: AvatarRuntimeConfig;
  request: AvatarTranslationRequest | null;
  caption: string;
  state: AvatarPlaybackState;
  onStateChange: (state: AvatarPlaybackState) => void;
  onError: (message: string) => void;
}>(function AvatarStage(props, ref): ReactNode {
  const handle = (): HandTalkAvatarHandle | null =>
    ref && typeof ref === "object" ? ref.current : null;

  return (
    <div className="avatar-stage">
      <div className="video-label avatar-label">
        <span><Icon name="spark" /> Experimental synthetic ASL avatar</span>
        <small>Hand Talk · automatic output · not Deaf-reviewed</small>
      </div>
      <HandTalkAvatar
        ref={ref}
        config={props.config}
        request={props.request}
        caption={props.caption}
        onStateChange={props.onStateChange}
        onError={props.onError}
      />
      {!props.request ? (
        <div className="avatar-ready-copy">
          <strong>Avatar ready</strong>
          <span>Speak, upload, or type a short English message.</span>
        </div>
      ) : null}
      <div className="video-caption">
        <span>English caption · final</span>
        <p>{props.caption || "Final English words will remain visible here."}</p>
      </div>
      <div className="video-actions avatar-actions">
        {props.state === "paused" ? (
          <button type="button" onClick={() => handle()?.resume()}><Icon name="play" /> Resume</button>
        ) : (
          <button type="button" disabled={props.state !== "translating"} onClick={() => handle()?.pause()}><Icon name="pause" /> Pause</button>
        )}
        <button
          type="button"
          disabled={!props.request || props.state === "loading"}
          onClick={() => void handle()?.repeat().catch((error: unknown) => props.onError(
            error instanceof Error ? error.message : "The avatar could not replay this message.",
          ))}
        ><Icon name="replay" /> Replay</button>
        <button
          type="button"
          disabled={props.state !== "translating" && props.state !== "paused"}
          onClick={() => void handle()?.stop().catch((error: unknown) => props.onError(
            error instanceof Error ? error.message : "The avatar could not stop this message.",
          ))}
        >Stop</button>
        <label>
          <span className="sr-only">Avatar speed</span>
          <select defaultValue="normal" onChange={(event) => handle()?.changeSpeed(event.target.value as "normal" | "slow" | "fast")}>
            <option value="slow">Slow</option>
            <option value="normal">Standard</option>
            <option value="fast">Fast</option>
          </select>
        </label>
      </div>
    </div>
  );
});

const VideoStage = forwardRef<HTMLVideoElement, { asset: PlaybackAsset; caption: string; onStarted: () => void; onEnded: () => void; onFailed: () => void }>(function VideoStage(props, ref): ReactNode {
  return (
    <div className="video-stage">
      <div className="video-label"><span><Icon name="verified" /> Human-recorded, Deaf-reviewed phrase</span><small>Catalog {props.asset.catalogVersion} · natural speed</small></div>
      <video ref={ref} src={props.asset.url} playsInline controls preload="metadata" onPlay={props.onStarted} onEnded={props.onEnded} onError={props.onFailed} aria-label={`ASL video for: ${props.caption}`} />
      <div className="video-caption"><span>English caption</span><p>{props.caption}</p></div>
      <div className="video-actions">
        <button type="button" onClick={() => void (ref && "current" in ref ? ref.current?.play() : undefined)}><Icon name="play" /> Play</button>
        <button type="button" onClick={() => { if (ref && "current" in ref) ref.current?.pause(); }}><Icon name="pause" /> Pause</button>
        <button type="button" onClick={() => { if (ref && "current" in ref && ref.current) { ref.current.currentTime = 0; void ref.current.play(); } }}><Icon name="replay" /> Replay</button>
        <span>1×</span>
      </div>
    </div>
  );
});

function FeedbackPanel(props: { open: boolean; sent: boolean; onToggle: () => void; onSend: (category: "meaning_accuracy" | "wrong_context" | "facial_grammar" | "presentation_crop" | "presentation_mirror" | "playback_failure" | "caption_issue", severity: "low" | "medium" | "high" | "critical") => Promise<void> }): ReactNode {
  const [category, setCategory] = useState<"meaning_accuracy" | "wrong_context" | "facial_grammar" | "presentation_crop" | "presentation_mirror" | "playback_failure" | "caption_issue">("meaning_accuracy");
  const [severity, setSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  if (props.sent) return <p className="feedback-thanks" role="status"><Icon name="check" /> Feedback recorded without transcript or free text.</p>;
  return (
    <div className="feedback-panel">
      <button className="text-button" type="button" aria-expanded={props.open} onClick={props.onToggle}><Icon name="flag" /> Report an issue with this phrase</button>
      {props.open ? (
        <div className="feedback-form">
          <label>Issue category<select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="meaning_accuracy">Meaning accuracy</option><option value="wrong_context">Wrong context</option><option value="facial_grammar">Facial grammar</option><option value="presentation_crop">Video crop</option><option value="presentation_mirror">Mirrored video</option><option value="playback_failure">Playback failure</option><option value="caption_issue">Caption issue</option></select></label>
          <label>Severity<select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
          <button className="primary-button" type="button" onClick={() => void props.onSend(category, severity)}>Send structured feedback</button>
          <small>No free text, audio, or transcript is submitted.</small>
        </div>
      ) : null}
    </div>
  );
}

function CommunicationFallback(): ReactNode {
  return (
    <details className="support-details">
      <summary><Icon name="route" /><span><strong>Need another communication option?</strong><small>Typing, captions, and qualified support</small></span><Icon name="chevron" /></summary>
      <div><p>Ask the visitor what works best. Keep final captions visible, offer a keyboard, or arrange qualified communication support under your organization’s policy.</p></div>
    </details>
  );
}

function MetricsView(props: { metrics: DashboardMetrics | null; error: string; isDemo: boolean; onBack: () => void }): ReactNode {
  if (props.error) return <section className="metrics-page"><button className="text-button" onClick={props.onBack}>← Back to reception</button><div className="error-message" role="alert">{props.error}</div></section>;
  if (!props.metrics) return <section className="metrics-page"><div className="metrics-loading" role="status"><span className="spinner" /> Loading privacy-safe metrics…</div></section>;
  const metrics = props.metrics;
  const maxReason = Math.max(1, ...metrics.fallbackReasons.map((item) => item.count));
  return (
    <section className="metrics-page" aria-labelledby="metrics-title">
      <div className="metrics-heading">
        <div><p className="eyebrow">Pilot operations</p><h1 id="metrics-title">What is working at reception</h1><p>Aggregated events only. No audio or transcript content.</p></div>
        <button className="secondary-button" type="button" onClick={props.onBack}>Back to reception</button>
      </div>
      {props.isDemo ? <div className="demo-data-note"><Icon name="flask" /><strong>Illustrative metrics</strong><span>These values are static UI samples—not observed customer activity.</span></div> : null}
      <div className="metrics-grid">
        <MetricCard label="Sessions" value={metrics.sessions.toLocaleString()} detail={metrics.windowLabel} icon="conversation" />
        <MetricCard label="Phrase candidates" value={metrics.supportedCandidates.toLocaleString()} detail="Supported, pending staff review" icon="spark" />
        <MetricCard label="Staff acceptance" value={percent(metrics.staffAcceptanceRate)} detail="Of supported candidates" icon="check" />
        <MetricCard label="Playback success" value={percent(metrics.playbackSuccessRate)} detail="Approved clips completed" icon="play" />
      </div>
      <div className="metrics-detail-grid">
        <section className="metrics-card" aria-labelledby="fallback-metrics-title">
          <div className="metrics-card-heading"><div><p className="step-label">Fallback health</p><h2 id="fallback-metrics-title">Why signing was not played</h2></div><strong>{percent(metrics.fallbackRate)} overall</strong></div>
          <div className="reason-bars">
            {metrics.fallbackReasons.map((item) => <div className="reason-row" key={item.reason}><span>{humanize(item.reason)}</span><div><i style={{ width: `${item.count / maxReason * 100}%` }} /></div><strong>{item.count}</strong></div>)}
          </div>
        </section>
        <section className="metrics-card" aria-labelledby="latency-title">
          <p className="step-label">Service quality</p><h2 id="latency-title">P95 latency</h2>
          <div className="latency-list"><div><span>Final caption after stop</span><strong>{formatMs(metrics.p95FinalTranscriptMs)}</strong><small>Target &lt; 1.5 s</small></div><div><span>Caption to phrase candidate</span><strong>{formatMs(metrics.p95IntentMs)}</strong><small>Target &lt; 2.5 s</small></div></div>
        </section>
      </div>
      <section className="agent-card" aria-labelledby="agent-title">
        <div><p className="step-label">Daily operations assistant</p><h2 id="agent-title">Aggregate review runs</h2><p>May rank support problems and suggest follow-ups. Cannot publish ASL, modify the catalog, or contact customers.</p></div>
        <div className="agent-runs"><div><span className="run-status" /><span>{metrics.windowLabel}</span><strong>{metrics.agentRunCount} aggregate run{metrics.agentRunCount === 1 ? "" : "s"}</strong><small>Run contents are not exposed in this privacy-safe view.</small></div></div>
      </section>
    </section>
  );
}

function MetricCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: IconName }): ReactNode {
  return <div className="metric-card"><div className="metric-icon"><Icon name={icon} /></div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function StateBadge({ state }: { state: ProcessState }): ReactNode {
  const labels: Record<ProcessState, string> = { idle: "Ready", preparing: "Preparing", listening: "Listening", finalizing: "Finalizing", classifying: "Checking phrase", caption_ready: "Caption ready", candidate: "Staff review", avatar_confirmation: "Avatar confirmation", fallback: "Safe fallback", playing: "ASL + caption" };
  return <span className={`state-badge ${state}`}><span />{labels[state]}</span>;
}

function BrandMark({ compact = false }: { compact?: boolean }): ReactNode {
  return <div className={`brand ${compact ? "compact" : ""}`}><span className="brand-symbol" aria-hidden="true"><i /><i /></span><span><strong>SignBridge</strong><small>Reception</small></span></div>;
}

type IconName = InputMethod | "shield" | "hands" | "captions" | "info" | "flask" | "key" | "arrow" | "logout" | "microphone" | "stop" | "upload" | "route" | "check" | "play" | "pause" | "replay" | "verified" | "flag" | "chevron" | "conversation" | "spark";

function Icon({ name }: { name: IconName }): ReactNode {
  const paths: Record<IconName, ReactNode> = {
    shield: <><path d="M12 3 5 6v5c0 4.6 2.9 8 7 10 4.1-2 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/></>,
    hands: <><path d="M8 12V6a1.5 1.5 0 0 0-3 0v7"/><path d="M11 11V4.5a1.5 1.5 0 0 0-3 0V11"/><path d="M14 11V5.5a1.5 1.5 0 0 0-3 0"/><path d="M17 13V8a1.5 1.5 0 0 0-3 0v5"/><path d="M5 11.5 3.5 10a1.5 1.5 0 0 0-2 2.2l4.2 5A6 6 0 0 0 10.3 19H12a5 5 0 0 0 5-5v-1"/></>,
    captions: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 10a2 2 0 1 0 0 4M18 10a2 2 0 1 0 0 4"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
    flask: <><path d="M9 3h6M10 3v5l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
    logout: <><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 8l4 4-4 4M18 12H9"/></>,
    microphone: <><rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 15v4h14v-4"/></>,
    type: <><path d="M5 5h14M12 5v14M8 19h8"/></>,
    phrases: <><path d="M4 5h16v11H8l-4 4V5Z"/><path d="M8 9h8M8 12h5"/></>,
    speak: <><path d="M5 9v6M9 6v12M13 4v16M17 8v8M21 10v4"/></>,
    route: <><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h3a3 3 0 0 0 3-3v-6a3 3 0 0 1 3-3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    play: <path d="m8 5 11 7-11 7V5Z"/>,
    pause: <><path d="M9 5v14M15 5v14"/></>,
    replay: <><path d="M4 8V4m0 0h4M5 5a9 9 0 1 1-1 12"/></>,
    verified: <><path d="m12 3 2 2.1 2.8-.2.9 2.7 2.3 1.6-1.1 2.6 1.1 2.6-2.3 1.6-.9 2.7-2.8-.2L12 21l-2-2.1-2.8.2-.9-2.7L4 14.8l1.1-2.6L4 9.6 6.3 8l.9-2.7 2.8.2L12 3Z"/><path d="m9 12 2 2 4-4"/></>,
    flag: <><path d="M5 21V4M5 5h10l-1 4 3 3H5"/></>,
    chevron: <path d="m8 10 4 4 4-4"/>,
    conversation: <><path d="M4 5h16v12H8l-4 4V5Z"/><path d="M8 9h8M8 13h5"/></>,
    spark: <><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="m18 15 .7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7L18 15Z"/></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

const DEMO_METRICS: DashboardMetrics = {
  windowLabel: "Illustrative 7-day window",
  sessions: 126,
  supportedCandidates: 84,
  fallbackRate: 0.18,
  staffAcceptanceRate: 0.91,
  playbackSuccessRate: 0.995,
  p95FinalTranscriptMs: 1120,
  p95IntentMs: 1840,
  fallbackReasons: [
    { reason: "outside_pilot_domain", count: 11 },
    { reason: "staff_rejected", count: 7 },
    { reason: "no_final_transcript", count: 4 },
    { reason: "high_stakes_content", count: 2 },
  ],
  agentRuns: [{ startedAt: new Date().toISOString(), status: "sample_only", model: "No model executed" }],
  agentRunCount: 7,
};

function connectionLabel(state: ConnectionState): string {
  return { idle: "Ready to start", connected: "Speech connected", connecting: "Connecting", offline: "Typing available" }[state];
}

function formatError(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return "That access code is not valid or has expired.";
  return error instanceof Error ? error.message : "Something went wrong. Use captions or typing to continue.";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function validateAudioDuration(file: File): Promise<string | null> {
  if (typeof Audio === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(file);
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => reject(new Error("Audio metadata could not be read."));
      audio.src = url;
    });
    return Number.isFinite(duration) && duration > 60 ? "Choose a recording that is 60 seconds or shorter." : null;
  } catch {
    return "This audio file could not be read. Choose a valid WAV, MP3, or WebM recording.";
  } finally {
    URL.revokeObjectURL(url);
  }
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function percent(value: number): string {
  return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function formatMs(value: number | null): string {
  if (value === null) return "Not enough data";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}
