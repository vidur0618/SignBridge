# Privacy and security

## Data-flow notice

The reviewed phrase lane and experimental Hand Talk lane have different processors.

| Input or record | SignBridge handling | External processing |
| --- | --- | --- |
| Live microphone audio | Captured only after staff action; streamed to the same-origin API; stopped after 15 seconds; not retained by the application | Google Speech-to-Text V2 when cloud mode is enabled |
| Uploaded audio | Limited to WAV, MP3, or WebM, 10 MB and 60 seconds; processed in memory; not retained by the application | Google Speech-to-Text V2 when cloud mode is enabled |
| Provisional transcript | Displayed visually; not classified and never sent to Hand Talk | Google may process it as part of streaming recognition |
| Finalized or typed English in reviewed phrase lane | Held in process memory while a decision is pending; never stored in application telemetry | Vertex/Gemini receives finalized text only after deterministic gating |
| Finalized or typed English in avatar lane | Kept as a visible caption; checked in memory after per-message staff confirmation; only an allowed message is sent by the authenticated browser to Hand Talk | Hand Talk processes the exact authorized English text to produce avatar output |
| Operational event | Random IDs, configured site, timings, provider/model actually used, intent/asset/authorization IDs, fallback, staff decision, and playback/avatar result only | Firestore when cloud mode is enabled; no raw audio or transcript text |

Display a just-in-time notice before microphone, upload, or avatar processing. Captions-only mode makes no Hand Talk request. Clear client transcript state at session end. Private contracts, identities, payments, pilot notes, and customer contact details remain outside Git and product telemetry.

Application non-retention does not mean provider non-retention. Cloud and Hand Talk request metadata or submitted text may be processed or retained under their configurations and contracts. The pilot notice and data-processing record must state the real providers and settings.

## Hand Talk third-party boundary

`HANDTALK_TOKEN` is read by the API but, when configured, is returned through authenticated `GET /api/avatar/config` with `Cache-Control: no-store`. The browser must receive it because Hand Talk's official [JavaScript quick start](https://api-docs.handtalk.me/v1/en/javascript/getting-start) initializes `HTApi` with a token. Treat it as a public-client vendor credential:

- obtain a token contractually authorized for the fixed 1.0.0 channel and the exact production origin;
- request origin/domain restrictions, least privilege, expiry, rotation, revocation, usage alerts, and separate staging/production tokens;
- never commit the token, put it in screenshots, logs, build-time Vite variables, or expose it before site authentication;
- assume a signed-in user can inspect a browser-delivered token; do not reuse it as an administrative or server credential;
- pin `HANDTALK_SDK_URL` to the official HTTPS 1.0.0 asset and keep the CSP allowlist narrow;
- record the SDK hash or vendor release evidence during deployment because the third-party script is not vendored here.

The app does not mount the remote SDK merely because a token exists. Captions-only is the default; a staff member must select the experimental mode and confirm each exact finalized or explicitly submitted message. `POST /api/avatar/authorize` checks that text in memory and records only a random authorization ID and structured outcome. `POST /api/avatar/events` accepts only authorization ID, start/completion/failure, and bounded latency. An allowed message is then sent directly from the browser, and the CSP permits provider connections to `handtalk.me`, `*.handtalk.me`, and `wss://*.handtalk.me`. The repository has not verified which endpoints, subprocessors, regions, telemetry, or retention rules the v1 SDK uses. Hand Talk's separate [plugin data-collection documentation](https://docs.handtalk.me/en/docs/duvidas-erros-limitacoes/coleta-de-dados/) says that plugin metrics can be disabled only partly and that translated-word totals remain processed; do not assume that page defines the v1 SDK's behavior. Obtain SDK-specific written terms and a DPA before entering customer text.

## Google credentials and environment

When `USE_GOOGLE_CLOUD=true`, the current configuration requires:

- `GOOGLE_CLOUD_PROJECT` and `SIGN_ASSET_BUCKET`;
- `GOOGLE_CLOUD_LOCATION`, `GOOGLE_SPEECH_LOCATION`, `GOOGLE_SPEECH_RECOGNIZER`, `GOOGLE_SPEECH_MODEL`, and `GEMINI_MODEL` set to deployed, authorized resources/models;
- `FIRESTORE_DATABASE` and least-privilege permissions for Speech-to-Text, Vertex AI, the private signing bucket, and Firestore;
- Application Default Credentials supplied by the attached Cloud Run service account, or an explicitly authorized local ADC login/service-account file outside Git.

Do not place a Google access token or service-account JSON in environment examples, Git, browser code, or application logs. `gcloud auth application-default login` is a local developer action, not a production credential strategy. The server currently calls the Vertex `aiplatform.googleapis.com` endpoint; confirm that the configured `GEMINI_MODEL` exists in the selected project/location instead of treating an environment string as proof of availability.

## Controls

- Same-origin browser/API deployment; no wildcard CORS.
- HttpOnly, Secure, SameSite=Strict site session derived from an access code.
- Strict runtime validation for requests, model responses, catalog entries, and stored events.
- 15-second live capture, 10 MB/60-second uploads, per-session/per-site rate limits, one-instance pilot safety cap, and billing/provider usage alerts.
- Enum-only Gemini output with no tools, URLs, or client-owned reviewed-asset catalog.
- Content Security Policy that adds the pinned Hand Talk script and provider origins only when a token is configured.
- Generic user-facing errors; internal logs omit request bodies, transcripts, filenames, stack traces, cookies, authorization headers, and credentials.
- Immediate captions-only fallback on ASR, model, SDK, WebGL, network, or playback failure.

## Threat and failure cases

Prompt injection in a reviewed-lane transcript cannot invoke a tool or select an unknown asset. A corrupt, withdrawn, unapproved, or hash-mismatched reviewed asset cannot receive a playback URL. Those controls do not validate Hand Talk output: open input is sent to a third-party translator, and malicious or consequential text may still generate plausible-looking motion. Consequential-use warnings, staff training, mode selection, captions, and a human support path remain mandatory.

Authentication, rate limits, size limits, CSP, and concurrency caps reduce abuse; they do not replace provider quotas, cloud budgets, token restrictions, a DPA, or security review.

## Current evidence boundary

As of 2026-08-02, no Hand Talk token, SDK network exchange, provider-generated avatar, Google ADC identity, live Speech-to-Text output, or Vertex/Gemini response has been tested. Local mocks and configuration tests establish code behavior only. Before a pilot, inspect deployed browser network traffic and server logs, verify token/ADC permissions, confirm provider retention and deletion terms, exercise revocation, and confirm that no raw audio or transcript appears in application-owned storage or logs.
