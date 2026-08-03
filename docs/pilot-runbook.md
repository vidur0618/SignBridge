# Paid pilot runbook

SignBridge has a reviewed phrase lane and an optional experimental Hand Talk avatar lane. The avatar is not a substitute for the reviewed catalog or a qualified interpreter. It remains disabled for customer traffic until every avatar item in the [release checklist](release-checklist.md) is signed off.

## Before opening

1. Record the deployed commit, Cloud Run revision, environment mode, catalog version, Google recognizer/model, Hand Talk enabled/disabled state, fixed SDK URL, and approved release record.
2. Verify the reviewed catalog is published, every asset returns the approved hash, and no asset is withdrawn. If no approved assets exist, clearly mark reviewed playback unavailable.
3. Test microphone denial, provisional/final captions, one supported and one unsupported reviewed case, typing, manual phrase selection, captions-only mode, replay/pause, session clearing, and human-support guidance without customer data.
4. Confirm the site's qualified interpreter/accommodation process and remove any phrase that promises unavailable support.
5. Train staff that only final speech text can enter a signing lane, every reviewed intent must be confirmed, avatar motion may be linguistically wrong, and consequential communication is excluded.

## Avatar go/no-go packet

Before enabling `HANDTALK_TOKEN`, the pilot owner must sign one release packet containing:

- executed commercial terms and DPA for the exact production domain and use;
- a browser-public, domain-bound fixed-channel token with separate staging/production credentials, quota/rate/spend caps, alerts, expiry, rotation, and revocation ownership;
- the exact `https://api-cdn.handtalk.me/sdk/1.0.0/ht-api-sdk.min.js` URL, retrieval timestamp/headers, verified SHA-256, and retained vendor release/channel evidence;
- deployed browser-network inspection and real-token success/failure results;
- the exact human-recorded, independently Deaf-reviewed signed ASL introduction and its caption, rights, hash, version, and approval;
- independent compensated Deaf expert and user evaluation of the exact SDK, avatar, browser, presentation, and frozen unseen inputs;
- a named kill-switch operator and successful shutdown/revocation rehearsal.

The current integration target alone is not a go decision. As of 2026-08-02, no real Hand Talk token/output, contract/DPA, signed introduction, or independent evaluation is recorded.

## Signed introduction and opt-in

Before the first avatar request in each visitor session:

1. Play the approved human-recorded ASL introduction at natural speed while showing its exact English caption.
2. The introduction must explain that the next signer is a synthetic experimental avatar, may be wrong, is not an interpreter, keeps captions visible, can be stopped, and cannot be used for important or consequential decisions.
3. Offer captions, typing, the reviewed phrase lane, and qualified human support as equal alternatives.
4. Ask the visitor to opt in explicitly. Do not infer consent from presence, silence, or prior microphone consent.
5. If the introduction asset, approval, or playback fails, do not use the avatar.

The application does not yet contain an approved signed introduction asset. Until one is implemented and accepted, Hand Talk remains an internal evaluation path only.

## During the pilot

- Obtain visible, informed permission before microphone or upload processing.
- Keep a trained staff member present and let the visitor switch to captions-only or typing at any time.
- Treat interim captions as provisional; only `isFinal` speech may be sent for signing.
- Keep the finalized English caption visible throughout reviewed or avatar output.
- Never enter or send emergencies, medical/legal/security/payment/identity/employment-rights content or other consequential communication to the avatar. Stop and invoke qualified support.
- Do not treat provider completion, visual fluency, or a familiar isolated sign as proof that the full ASL meaning is accurate.
- Report reviewed-asset issues by session/asset ID and avatar issues by session/provider-version category without copying transcript text or identities into telemetry or issue trackers.
- Stop the avatar immediately if the visitor or staff member reports unclear, offensive, incorrect, inaccessible, or contextually unsafe output.

## Avatar kill switch

Invoke the kill switch for any serious meaning error, privacy/security concern, unexpected SDK bytes/origin, contract lapse, quota/spend anomaly, token exposure, provider instability, inaccessible control, or loss of the signed introduction/human-support path.

1. Tell staff to select captions-only and stop new avatar requests.
2. Remove or blank `HANDTALK_TOKEN` in the Cloud Run configuration/secret binding and deploy a new revision.
3. In an authenticated session, verify `/api/avatar/config` returns `enabled: false` and no token; verify signed-out access remains denied.
4. Confirm captions, typing, manual/reviewed phrases, and human-support guidance still work.
5. Request vendor-side token revocation and, when appropriate, set its quota to zero.
6. Close existing sessions, notify pilot staff, record the time/revision/reason without conversation text, and preserve content-free network/release evidence.

Re-enable only after the incident owner, privacy/security lead, pilot owner, and—when meaning or presentation is involved—independent Deaf reviewer approve a new exact release packet and token.

## Commercial and contest evidence

Keep the invoice, payment receipt, simple P&L, customer agreement, consented testimonial, user/customer counts, aggregate dashboard, Google invocation evidence, Hand Talk contract/token/channel and actual provider-execution evidence, SDK hash/release record, signed-introduction approval, independent Deaf-evaluation report, deployment record, and actual costs in a private evidence system. Identify related-party revenue.

Public materials must distinguish the reviewed lane, experimental avatar lane, captions, targets, vendor assertions, actual provider observations, and independent human findings. Never convert the proposed pilot price, configured token, provider animation, or mock result into evidence of a paid customer or accurate unrestricted interpretation.
