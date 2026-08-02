# Privacy and security

## Data handling

- Display a just-in-time notice before microphone or upload processing.
- Record only after an explicit staff action and stop after 15 seconds.
- Accept uploads only after the user confirms they are authorized to process the recording.
- Process raw audio and transcripts in memory. Do not save them to disk, Cloud Storage, Firestore, analytics, or application logs.
- Clear client transcript state at session end.
- Operational events contain random session identifiers, a configured site identifier, timings, provider/model names actually used, intent and asset IDs, fallback reasons, staff decisions, and playback results.
- A finalized transcript remains only in process memory while the staff confirmation is pending. It is deleted when consumed or after a two-minute expiry timer; it is never written to Firestore or application logs.
- Private contracts, identities, payments, pilot notes, and customer contact details remain outside Git and outside product telemetry.

Cloud provider request metadata may still exist under the configured Google Cloud account. The pilot notice and data-processing record must describe the selected provider configuration accurately.

## Controls

- Same-origin browser/API deployment; no wildcard CORS.
- HttpOnly, Secure, SameSite=Strict session cookie derived from a site access code.
- Server-side credentials only; prefer workload identity to static keys.
- Strict schema validation for every request, model response, catalog, and stored event.
- 15-second live capture, 10 MB/60-second uploads, per-session and per-site rate limits, a one-instance pilot safety cap, and billing alerts. Three-instance availability remains blocked on distributed confirmation, playback-grant, and concurrency state.
- Enum-only Gemini output with no tools, URLs, or client-owned candidate catalog.
- Content Security Policy, restrictive Permissions Policy, anti-sniffing, frame-ancestor, and referrer headers.
- Generic user-facing errors; internal events contain no raw body, transcript, filename, stack trace, or credential.

## Threat cases

Prompt injection in a transcript cannot invoke a tool or select an unknown asset. Malicious, malformed, unsupported, or high-stakes content falls back. A corrupt, withdrawn, unapproved, or hash-mismatched asset never receives a playback URL. Authentication, rate limits, size limits, and concurrency caps limit quota abuse; they do not replace cloud budgets and alerts.
