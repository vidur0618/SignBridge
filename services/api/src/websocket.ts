import { randomUUID } from "node:crypto";
import {
  LIVE_AUDIO_BINARY_FRAME_MAX_BYTES,
  LiveClientMessageSchema,
  LiveServerEventSchema,
  type AudioSession,
  type LiveServerEvent,
  type ReceptionIntentId,
  type TranscriptSegment,
  type UnsupportedReasonCode,
} from "@signbridge/contracts";
import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "./app.js";
import type { LiveSpeechConnection } from "./adapters/speech.js";
import { requireSite } from "./security.js";
import { TranscriptionFallbackError } from "./transcription-service.js";

const MAX_LIVE_AUDIO_BYTES = 16_000 * 2 * 15;
const MAX_LIVE_WALL_TIME_MS = 17_000;

export async function registerLiveTranscription(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  app.get(
    "/api/live-transcription",
    { websocket: true, preValidation: requireSite },
    (socket, request) => {
      const auth = request.authSession;
      if (!auth) {
        send(socket, {
          type: "error",
          reasonCode: "session_expired",
          recoverable: false,
          message: "A valid site session is required.",
        });
        socket.close(1008, "authentication required");
        return;
      }

      let session: AudioSession | null = null;
      let speech: LiveSpeechConnection | null = null;
      let acquired = false;
      let closed = false;
      let stopping = false;
      let finishing = false;
      let audioBytes = 0;
      let sequence = 0;
      let configuredAt = 0;
      let stoppedAt: number | null = null;
      let firstProvisionalRecorded = false;
      let terminalRecorded = false;
      let wallTimer: NodeJS.Timeout | null = null;
      let finalTimer: NodeJS.Timeout | null = null;
      const finalSegments: TranscriptSegment[] = [];

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        if (wallTimer) clearTimeout(wallTimer);
        if (finalTimer) clearTimeout(finalTimer);
        speech?.destroy();
        if (acquired) dependencies.liveConcurrency.release(auth.siteId);
      };

      const recordTerminal = async (outcome: {
        fallbackReason?: UnsupportedReasonCode;
        intentId?: ReceptionIntentId;
      } = {}): Promise<void> => {
        if (terminalRecorded) return;
        terminalRecorded = true;
        await dependencies.events.record({
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          siteId: auth.siteId,
          sessionId: auth.sessionId,
          type: "transcription_completed",
          flow: "live",
          speechProvider: dependencies.transcription.speech.providerName,
          speechModel: dependencies.transcription.speech.model,
          ...(outcome.fallbackReason ? { fallbackReason: outcome.fallbackReason } : {}),
          ...(outcome.intentId ? { intentId: outcome.intentId } : {}),
        });
      };

      const finish = async (): Promise<void> => {
        if (closed || finishing) return;
        finishing = true;
        if (finalTimer) clearTimeout(finalTimer);
        if (finalSegments.length === 0 && session) {
          send(socket, {
            type: "fallback",
            sessionId: session.id,
            reasonCode: "no_final_transcript",
          });
          await recordTerminal({ fallbackReason: "no_final_transcript" });
        } else if (session) {
          if (stoppedAt != null) {
            await dependencies.events.record({
              eventId: randomUUID(),
              occurredAt: new Date().toISOString(),
              siteId: auth.siteId,
              sessionId: auth.sessionId,
              type: "latency_sample",
              flow: "live",
              latencyKind: "final_after_release",
              latencyMs: Math.max(0, Date.now() - stoppedAt),
            });
          }
          try {
            const bundle = await dependencies.transcription.classifyFinalSegments(
              auth,
              session,
              finalSegments,
              "live",
            );
            if (bundle.detectedIntent.status === "supported") {
              send(socket, {
                type: "intent.candidate",
                utterance: bundle.utterance,
                detectedIntent: bundle.detectedIntent,
              });
            } else {
              send(socket, {
                type: "fallback",
                sessionId: session.id,
                utteranceId: bundle.utterance.id,
                reasonCode: bundle.detectedIntent.reasonCode,
              });
            }
            await recordTerminal(
              bundle.detectedIntent.status === "supported"
                ? { intentId: bundle.detectedIntent.intentId }
                : { fallbackReason: bundle.detectedIntent.reasonCode },
            );
          } catch (error) {
            const reasonCode: UnsupportedReasonCode =
              error instanceof TranscriptionFallbackError
                ? error.reasonCode
                : "model_unavailable";
            if (error instanceof TranscriptionFallbackError) {
              send(socket, {
                type: "fallback",
                sessionId: session.id,
                reasonCode,
              });
            } else {
              sendError(
                socket,
                session.id,
                reasonCode,
                true,
                "Captions remain available, but no phrase candidate could be created.",
              );
            }
            await recordTerminal({ fallbackReason: reasonCode });
          }
        }
        if (session) send(socket, { type: "speech_end", sessionId: session.id });
        cleanup();
        socket.close(1000, "complete");
      };

      socket.on("message", (raw: unknown, isBinary: boolean) => {
        void (async () => {
          if (closed) return;
          if (isBinary) {
            if (!session || !speech || stopping) {
              sendError(socket, session?.id, "invalid_audio", true, "Configure the audio session before sending audio.");
              return;
            }
            const audio = toBuffer(raw);
            if (audio.length > LIVE_AUDIO_BINARY_FRAME_MAX_BYTES) {
              sendError(socket, session.id, "invalid_audio", false, "An audio frame exceeded the allowed size.");
              await recordTerminal({ fallbackReason: "invalid_audio" });
              cleanup();
              socket.close(1009, "frame too large");
              return;
            }
            audioBytes += audio.length;
            if (audioBytes > MAX_LIVE_AUDIO_BYTES) {
              sendError(socket, session.id, "audio_too_long", false, "Live audio is limited to 15 seconds.");
              await recordTerminal({ fallbackReason: "audio_too_long" });
              cleanup();
              socket.close(1009, "audio too long");
              return;
            }
            speech.write(audio);
            return;
          }

          let message: unknown;
          try {
            message = JSON.parse(toBuffer(raw).toString("utf8")) as unknown;
          } catch {
            sendError(socket, session?.id, "invalid_audio", true, "The control message was not valid JSON.");
            return;
          }
          const parsed = LiveClientMessageSchema.safeParse(message);
          if (!parsed.success) {
            sendError(socket, session?.id, "invalid_audio", true, "The control message was not valid.");
            return;
          }

          if (parsed.data.type === "session.configure") {
            if (
              session ||
              parsed.data.sessionId !== auth.sessionId ||
              parsed.data.siteId !== auth.siteId ||
              parsed.data.consentVersion !== auth.consentVersion
            ) {
              sendError(socket, undefined, "session_expired", false, "Session configuration did not match the authenticated session.");
              cleanup();
              socket.close(1008, "session mismatch");
              return;
            }
            if (!dependencies.liveConcurrency.acquire(auth.siteId)) {
              sendError(socket, undefined, "rate_limited", true, "This site already has the maximum number of live sessions.");
              socket.close(1013, "site concurrency limit");
              return;
            }
            acquired = true;
            configuredAt = Date.now();
            session = dependencies.transcription.createAudioSession(
              auth,
              "live",
              "listening",
              "LINEAR16",
            );
            send(socket, { type: "session.ready", session });
            const sessionId = session.id;
            try {
              speech = dependencies.transcription.speech.startLive("en-US", {
                onSegment: (providerSegment) => {
                if (closed) return;
                const segment = dependencies.transcription.toTranscriptSegment(
                  sessionId,
                  sequence++,
                  providerSegment,
                );
                if (segment.state === "partial") {
                  send(socket, { type: "transcript.partial", segment });
                  if (!firstProvisionalRecorded) {
                    firstProvisionalRecorded = true;
                    void dependencies.events.record({
                      eventId: randomUUID(),
                      occurredAt: new Date().toISOString(),
                      siteId: auth.siteId,
                      sessionId: auth.sessionId,
                      type: "latency_sample",
                      flow: "live",
                      latencyKind: "first_provisional_caption",
                      latencyMs: Math.max(0, Date.now() - configuredAt),
                    });
                  }
                  return;
                }
                finalSegments.push(segment);
                send(socket, { type: "transcript.final", segment });
                },
                onSpeechEnd: () => {
                  if (!stopping) return;
                  if (finalSegments.length > 0) void finish();
                },
                onError: () => {
                  if (closed) return;
                  sendError(socket, sessionId, "invalid_audio", true, "Live transcription is unavailable. Use typed captions instead.");
                  if (stopping) {
                    void finish();
                    return;
                  }
                  void (async () => {
                    await recordTerminal({ fallbackReason: "invalid_audio" });
                    cleanup();
                    socket.close(1011, "transcription unavailable");
                  })();
                },
              });
            } catch {
              sendError(socket, sessionId, "invalid_audio", true, "Live transcription is unavailable. Use typed captions instead.");
              await recordTerminal({ fallbackReason: "invalid_audio" });
              cleanup();
              socket.close(1011, "transcription unavailable");
              return;
            }
            wallTimer = setTimeout(() => {
              sendError(socket, sessionId, "audio_too_long", false, "Live audio is limited to 15 seconds.");
              void (async () => {
                await recordTerminal({ fallbackReason: "audio_too_long" });
                cleanup();
                socket.close(1009, "audio too long");
              })();
            }, MAX_LIVE_WALL_TIME_MS);
            return;
          }

          if (!session || parsed.data.sessionId !== session.id && parsed.data.sessionId !== auth.sessionId) {
            sendError(socket, session?.id, "session_expired", false, "The session ID did not match.");
            return;
          }
          if (parsed.data.type === "session.cancel") {
            cleanup();
            socket.close(1000, "cancelled");
            return;
          }
          if (parsed.data.type === "audio.stop" && !stopping) {
            stopping = true;
            stoppedAt = Date.now();
            if (wallTimer) clearTimeout(wallTimer);
            speech?.stop();
            finalTimer = setTimeout(() => void finish(), 1_200);
          }
        })();
      });
      socket.on("close", cleanup);
      socket.on("error", cleanup);
    },
  );
}

interface SendableSocket {
  readonly readyState: number;
  send(data: string): void;
}

function send(socket: SendableSocket, event: LiveServerEvent): void {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(LiveServerEventSchema.parse(event)));
}

function sendError(
  socket: SendableSocket,
  sessionId: string | undefined,
  reasonCode: Extract<LiveServerEvent, { type: "error" }>["reasonCode"],
  recoverable: boolean,
  message: string,
): void {
  send(socket, {
    type: "error",
    ...(sessionId ? { sessionId } : {}),
    reasonCode,
    recoverable,
    message,
  });
}

function toBuffer(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw) && raw.every(Buffer.isBuffer)) return Buffer.concat(raw);
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  throw new TypeError("Unsupported WebSocket frame type");
}
