# Release checklist

This checklist has two independent lanes. A reviewed-catalog release does not approve Hand Talk output, and an operational Hand Talk SDK does not approve the reviewed catalog. Any unchecked item in a lane blocks claims and customer use for that lane.

## Shared code and infrastructure

- [ ] `pnpm verify` passes on Windows and Linux for the exact release commit.
- [ ] Current Chrome and Edge launch-path tests pass on the pilot laptop.
- [ ] Same-origin controls, cookies, rate/size/concurrency limits, security headers, budgets, log exclusions, and captions-only fallback are verified in the deployed revision.
- [ ] `/api/health` records actual mode, revision, deployment SHA, catalog version, and configured Google model strings.
- [ ] Google Cloud uses an attached least-privilege service account or other authorized ADC identity; no credential is committed or browser-delivered.
- [ ] A real final-only Speech-to-Text smoke test proves that provisional text cannot enter either signing lane.
- [ ] Consequential-use exclusions and qualified human-support procedures are visible, trained, and rehearsed.

## Reviewed phrase lane

- [ ] Ten exact phrase videos exist outside Git and have verified SHA-256 hashes.
- [ ] Signer consent, compensation, commercial distribution, contest/publicity, and withdrawal scope are retained privately.
- [ ] An independent Deaf reviewer approves each exact file, caption pairing, context, and presentation.
- [ ] The immutable catalog is published by a named human authority and no asset is withdrawn.
- [ ] Server-owned gating, Gemini enum response, staff confirmation, signed URL, replay/pause, and withdrawal paths pass on the named revision.
- [ ] Three to five compensated Deaf-user tests meet the bounded acceptance gates.

The reviewed lane remains disabled while the catalog has zero approved assets.

## Experimental Hand Talk lane

The fixed Hand Talk for Devs **1.0.0 integration is a target**, not provider-execution evidence. Do not set `HANDTALK_TOKEN` for customer traffic until every item below is complete.

### Commercial, privacy, and credential gates

- [ ] Executed vendor contract authorizes the fixed SDK/channel, ASL use, exact production domains, reception pilot, customer text, contest demonstration, and any required recording/screenshots.
- [ ] Executed DPA records roles, submitted text and telemetry, retention/deletion, subprocessors, hosting regions, security measures, incident notification, data-subject handling, and termination/export/deletion obligations.
- [ ] Vendor SLA/support, outage escalation, version-support period, accessibility responsibility, and change-notice process are retained.
- [ ] The browser-visible token is documented as a **public-client credential**, issued specifically for the fixed 1.0.0 channel, and bound by the vendor to the exact HTTPS production domain.
- [ ] Separate staging and production tokens have minimum quota, rate/concurrency and spend caps, alerts, expiry, named ownership, rotation schedule, revocation procedure, and no administrative/customer-report permissions.
- [ ] Token rotation and emergency revocation are rehearsed without exposing the token in Git, logs, screenshots, build artifacts, analytics, or issue trackers.

### Release-integrity and browser gates

- [ ] The release record contains the exact URL `https://api-cdn.handtalk.me/sdk/1.0.0/ht-api-sdk.min.js`, retrieval time, response headers, SHA-256 of the exact downloaded bytes, and a retained copy or vendor attestation permitted by contract.
- [ ] Hand Talk's [fixed-release documentation](https://api-docs.handtalk.me/v1/en/javascript/release-channels) and the vendor's token/channel confirmation are retained with the release record.
- [ ] The observed SDK hash matches the approved hash immediately before production; any byte change or redirect blocks launch pending review.
- [ ] CSP and browser-network inspection show only approved Hand Talk script, HTTPS, and WebSocket origins; submitted text, cookies/storage, telemetry, and error payloads are documented.
- [ ] Real-token Chrome and Edge tests cover WebGL unavailable, SDK load/auth failure, timeout, provider rejection, quota exhaustion, offline use, pause/resume/repeat/stop, refresh, logout, and captions-only behavior.
- [ ] An authenticated `/api/avatar/config` response is `no-store`; signed-out and captions-only flows cannot trigger provider use.

### Linguistic and consent gates

- [ ] A separate, human-recorded and independently Deaf-reviewed **signed ASL introduction** explains before opt-in that the avatar is synthetic and experimental, may be wrong, is not an interpreter, always has English captions, can be stopped, and cannot be used for consequential communication.
- [ ] The exact signed introduction bytes, caption/transcript, reviewer approval, rights, hash, version, and presentation are retained; a text-only notice is not a substitute.
- [ ] Staff present the signed introduction before the visitor's first avatar request and obtain explicit opt-in; declining selects captions, typing, the reviewed phrase lane, or human support without penalty.
- [ ] Independent compensated Deaf ASL experts evaluate the exact SDK version, avatar, browser, presentation, and frozen unseen input set; vendor claims and engineering review are not accepted as substitutes.
- [ ] Independent compensated Deaf users complete comprehension/task testing, with severity-rated meaning errors and no prohibited consequential scenarios.
- [ ] Public claims state the tested domain, sample, methods, version, limitations, errors, and date; “unrestricted accurate interpretation” and “certified interpretation” remain prohibited.

### Kill-switch gate

- [ ] The operator rehearses removing/blanking `HANDTALK_TOKEN`, deploying a new revision, and confirming authenticated `/api/avatar/config` returns `enabled: false` without a token.
- [ ] The operator confirms the UI immediately retains captions and routes staff to reviewed/manual/human-support fallback.
- [ ] Vendor-side token revocation, quota shutdown, active-session termination, incident recording, and staff notification are rehearsed.
- [ ] Named staff can invoke the kill switch without engineering approval during a meaning, privacy, contract, security, quota, availability, or accessibility incident.

## Pilot and submission

- [ ] Setup invoice is paid and recurring terms are documented; related-party revenue is identified.
- [ ] Pilot staff training covers both assurance levels, signed introduction/opt-in, captions, consequential-use exclusion, fallback, incident reporting, and the avatar kill switch.
- [ ] Actual product, customer, revenue, expense, Google execution, vendor execution, and human-evaluation evidence is retained privately.
- [ ] README, Devpost copy, and demo state what is implemented, provider-tested, human-approved, experimental, disabled, and blocked.
- [ ] Public video is under three minutes, uses authorized media, and never implies that a mock or plausible avatar motion proves ASL accuracy.

## Current blocker statement

As of 2026-08-02, no real Hand Talk token/provider output, Google ADC identity, live Google provider response, approved signed introduction, vendor contract/DPA, or independent Deaf evaluation is recorded. The experimental lane is therefore blocked from customer pilot and accuracy claims. The reviewed lane is also blocked from ASL playback until its human-recorded assets and approvals exist.
