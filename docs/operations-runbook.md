# Operations runbook

This runbook covers the bounded reception pilot. It does not authorize use for emergencies, medicine, law, security, payments, identity verification, employment rights, or any other consequential communication.

## Opening the location

1. Confirm the browser is the pilot-approved Chrome or Edge version and the device clock is correct.
2. Open the production URL, inspect `/api/health`, and verify its revision, deployment SHA, service mode, configured models, and published catalog version against the release record.
3. Test captions-only mode without speaking customer information.
4. Confirm typing, manual phrase selection, communication-support guidance, video pause, replay, captions, and keyboard navigation.
5. Confirm the front-desk escalation contact and qualified-interpreter procedure are available to staff.

If any health, catalog, authentication, transcription, or playback check fails, operate captions/typing only and notify the support contact. Never work around a withdrawn asset or a confirmation requirement.

## During an interaction

- Ask or visibly indicate consent before audio capture.
- Hold the microphone control only for the intended utterance; the limit is 15 seconds.
- Treat provisional text as provisional. Only the finalized caption enters intent selection.
- Read the finalized caption and candidate intent before choosing **Play ASL phrase**.
- Reject any inaccurate, ambiguous, name/number-heavy, consequential, or wrong-context candidate.
- Keep the finalized caption visible during playback and offer typing or human support at all times.
- Do not record customer names, transcript text, or sensitive details in feedback.

## End-of-day review

Review aggregate counts and latency only: completed sessions, fallback reasons, staff rejection rate, playback failures, provider/model execution counts, and operations-job status. Investigate trends without reconstructing individual conversations. Confirm billing alerts and error budgets have not fired.

## Content withdrawal

1. A designated content administrator marks the asset `withdrawn` in a new signed catalog decision.
2. Publish the new catalog version and confirm the old asset cannot receive a new signed URL.
3. Preserve the previous catalog, reviewer decision, and audit event; do not delete history.
4. Test manual, AI-candidate, and already-open-session paths against the withdrawal.
5. Notify affected pilot staff with the fallback phrase or captions-only instruction.

No corrected bytes may reuse the previous hash or asset version. Re-recording requires a new grant check and independent review.

## Incident priorities

| Severity | Example | Immediate action |
| --- | --- | --- |
| 1 | Wrong-context ASL playback, serious meaning error, privacy exposure, confirmation bypass | Disable ASL playback or the service, preserve content-free technical evidence, notify the pilot and content/security leads |
| 2 | Repeated transcription/classification failure, inaccessible critical control, catalog mismatch | Force captions/typing fallback, stop affected flow, triage before next opening |
| 3 | Isolated playback or latency problem with clear fallback | Record a predefined structured issue, monitor, schedule repair |

Never put raw audio, transcript text, visitor identity, access codes, session cookies, contracts, or payment details in an issue tracker or application log.

## Recovery and closeout

Recovery requires the exact code revision and catalog version to pass automated checks, a manual pilot-laptop smoke test, and any relevant human content review. Record who approved recovery and when. At pilot close, revoke site credentials, retain only the approved aggregate evidence and required financial/content records, and destroy any temporary operational material according to the pilot agreement.
