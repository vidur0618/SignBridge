# Operations runbook

This runbook covers the bounded reviewed phrase pilot and, only after separate release approval, an experimental Hand Talk avatar evaluation. Neither lane is authorized for emergencies, medicine, law, security, payments, identity verification, employment rights, or other consequential communication.

## Assurance levels

- **Reviewed phrase lane:** server-selected, staff-confirmed, human-recorded whole utterance with exact rights/hash and independent Deaf review.
- **Experimental avatar lane:** final or typed English sent to Hand Talk's fixed 1.0.0 browser SDK. Output is synthetic, may be wrong, is not independently approved per utterance, and is not certified interpretation.
- **Captions/typing/human support:** always available and the required fallback for uncertainty, failure, or consequential content.

Never describe the avatar as inheriting the reviewed catalog's approval.

## Opening the location

1. Confirm the browser is the pilot-approved Chrome or Edge version, WebGL state is known, and the device clock is correct.
2. Inspect `/api/health` and verify revision, SHA, service mode, Google model strings, and catalog against the release record.
3. Confirm whether the avatar is intentionally disabled or approved. An enabled response requires the exact signed go/no-go packet from the [pilot runbook](pilot-runbook.md); otherwise invoke the kill switch before opening.
4. Test captions-only mode without customer information and confirm it makes no Hand Talk request.
5. Confirm typing, manual phrase selection, human-support guidance, reviewed video controls where available, captions, and keyboard navigation.
6. If the avatar is approved, verify the authenticated no-store config, fixed 1.0.0 URL, approved SDK SHA-256/release evidence, selected avatar, domain-bound token, quota/alerts, provider health, controls, and browser network origins using synthetic text.
7. Confirm the approved human-recorded Deaf-reviewed signed introduction plays with its caption before avatar opt-in.
8. Confirm the front-desk escalation contact, qualified-interpreter procedure, and named avatar kill-switch operator are available.

Any failed health, catalog, signed-introduction, contract/DPA, token, SDK hash, network-origin, quota, authentication, transcription, accessibility, or playback check disables the affected signing lane. Continue with captions, typing, and human support; never work around a withdrawal, confirmation, or kill switch.

## During an interaction

- Ask or visibly indicate permission before audio capture.
- Hold the microphone control only for the intended utterance; the limit is 15 seconds.
- Treat provisional text as provisional. Only final speech text may enter either signing lane.
- For reviewed output, read the final caption and candidate before selecting **Play ASL phrase**; reject inaccurate, ambiguous, name/number-heavy, consequential, or wrong-context candidates.
- For experimental output, present the approved signed introduction first and obtain explicit opt-in. Let the visitor decline or stop without penalty.
- Keep the finalized English caption visible and offer captions, typing, reviewed phrases, or qualified human support at all times.
- Stop the avatar on any report of wrong meaning, omission/addition, offensive output, unclear fingerspelling, inaccessible controls, unexpected behavior, or visitor discomfort.
- Never record customer names, transcript text, sensitive details, tokens, or provider payloads in feedback or issue trackers.

## Vendor and token operations

The Hand Talk SDK token is delivered to the authenticated browser and must be operated as a public-client credential, not a secret server authority.

- Bind it at the vendor to the exact HTTPS domain and fixed 1.0.0 channel.
- Maintain separate staging/production tokens, least privilege, quota/rate/spend ceilings, alerts, expiry, owner, rotation date, and tested revocation.
- Review usage against pilot counts daily; investigate mismatches without reconstructing conversations.
- Rotate on schedule and immediately after suspected exposure, staff/vendor change, unexpected origin, contract change, or incident.
- Re-run the token, SDK hash, CSP/network, controls, signed-introduction, and smoke-test gates after every rotation or provider release.
- Do not follow a redirect, switch to `latest`/`beta`, accept changed bytes, or broaden provider origins without a new release review.

## Avatar kill switch

Trigger the kill switch for a severity-1 meaning or privacy event, token exposure, changed SDK bytes, unapproved origin, contract/DPA lapse, provider incident, quota/spend anomaly, repeated errors, accessibility failure, or unavailable signed introduction/human support.

1. Direct staff to captions-only and stop active avatar playback where possible.
2. Remove or blank `HANDTALK_TOKEN` from the Cloud Run revision/secret binding and deploy.
3. Verify authenticated `/api/avatar/config` returns `enabled: false` without a token and signed-out access is denied.
4. Verify no provider network request occurs in captions-only mode and fallback remains usable.
5. Revoke the token with Hand Talk, set quota to zero if available, and terminate/expire active site sessions.
6. Record the exact time, revision, token identifier—not the token—SDK hash, trigger, operator, and notifications without transcript text.

Re-enablement requires a fresh exact release record, token, smoke test, and named approvals. Meaning/presentation incidents also require independent Deaf review and, when necessary, repeat user evaluation.

## End-of-day review

Review available aggregate counts and latency only: sessions, fallback reasons, reviewed candidates/rejections, playback failures, actual provider/model executions, quota use, kill-switch state, and operations-job status. Until avatar aggregation is implemented, inspect raw client-observed avatar start/completion/failure events separately as troubleshooting signals—not proof of provider execution. Confirm budget/vendor alerts and contract dates. Investigate trends without reconstructing conversations or labeling deterministic, mocked, or client-asserted paths as provider calls.

## Reviewed content withdrawal

1. A designated content administrator marks the reviewed asset `withdrawn` in a new signed catalog decision.
2. Publish the new catalog and confirm the asset cannot receive a new signed URL.
3. Preserve the previous catalog, reviewer decision, and audit event.
4. Test manual, AI-candidate, and already-open-session paths.
5. Notify staff with captions/manual/human-support instructions.

No corrected bytes may reuse a hash or version. This process applies to reviewed catalog media; an avatar meaning incident uses the provider kill switch because there is no SignBridge-owned output asset to withdraw.

## Incident priorities

| Severity | Example | Immediate action |
| --- | --- | --- |
| 1 | Wrong-context reviewed clip, serious avatar meaning error, privacy/token exposure, confirmation/opt-in bypass, changed SDK bytes | Disable the affected signing lane or service; use captions/human support; revoke provider token when relevant; preserve content-free evidence; notify pilot, Deaf-review, privacy/security, and vendor leads |
| 2 | Repeated ASR/classification/avatar failure, inaccessible critical control, catalog mismatch, quota anomaly | Force captions/typing, stop the affected flow, investigate before reopening |
| 3 | Isolated latency/playback problem with clear fallback | Record a predefined structured issue, monitor, and schedule repair |

Never put raw audio, transcript text, visitor identity, access codes, session cookies, contracts, credentials, SDK token, or payment details in an issue tracker or application log.

## Recovery and closeout

Recovery requires the exact code revision, reviewed catalog, provider token/channel, SDK URL/hash, signed introduction, and browser network path to pass the relevant automated and manual checks. Preserve who approved recovery and when. At closeout, revoke site and vendor credentials, stop provider billing/quota, retain only approved aggregate evidence and required financial/content/vendor records, and destroy temporary operational material under the pilot agreement and DPA.

As of 2026-08-02, no real Hand Talk token/provider output, Google ADC identity/provider output, executed Hand Talk contract/DPA, approved signed introduction, or independent avatar evaluation is recorded. The experimental lane therefore remains blocked from customer operation.
