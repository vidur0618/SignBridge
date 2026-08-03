# Devpost submission draft

> **Status: evidence template, not a completed submission.** Replace every `REQUIRED` field with verified production, provider, customer, or human-evaluation evidence. Delete any sentence that cannot be substantiated before publishing.

## Project name

SignBridge Reception

## One-line description

A captions-first front-desk communication aid with a bounded human-recorded, independently Deaf-reviewed ASL phrase lane and an optional experimental Hand Talk WebGL avatar.

## Category

Small Business Services

## The problem

Front desks often lack a fast, respectful way to begin a bounded interaction with a Deaf ASL user. Captions can help but do not provide signed reception phrases. Unreviewed automatic signing can also introduce serious linguistic and safety risks, especially when plausible motion is mistaken for accurate interpretation.

## What it does

SignBridge keeps finalized English captions visible and offers two signing paths with different assurance levels:

- In the **reviewed phrase lane**, staff capture short English speech or upload audio. Google Speech-to-Text provisional words are display-only; only final text enters deterministic scope/safety checks. Gemini may select one of ten server-owned reception intents or `unsupported`. Staff must confirm before the system can retrieve one complete human-recorded, independently Deaf-reviewed, hash-bound ASL clip.
- In the **experimental avatar lane**, finalized speech/upload text or explicitly typed English can be sent by the authenticated browser to the fixed Hand Talk for Devs 1.0.0 JavaScript SDK, which targets a WebGL ASL avatar. This output may be wrong, is not independently approved per utterance, and is not certified interpretation.

Typing, manual phrases, captions-only communication, and qualified human support remain available. Neither lane is authorized for emergencies, medicine, law, security, payments, identity verification, employment rights, or other consequential communication.

## Current evidence boundary

The repository contains the hybrid integration target, but as of 2026-08-02:

- no real Hand Talk token or provider-generated avatar output has been tested;
- no Google ADC identity, real Speech-to-Text result, or Vertex/Gemini response has been recorded;
- the reviewed catalog contains no approved signing media and playback is disabled;
- no Hand Talk commercial contract/DPA, approved signed ASL introduction, independent Deaf avatar evaluation, paid customer, invoice payment, or production deployment is claimed.

Do not present a local mock, configured model/token string, provider animation, or vendor description as production AI or ASL-accuracy evidence.

## How it is built

- React/Vite interface with keyboard, reflow, reduced-motion, forced-colors, persistent captions, captions-only mode, and WebGL avatar host.
- Fastify REST/WebSocket service and shared runtime-validated TypeScript contracts.
- Google Cloud Speech-to-Text V2 for English transcription, with partial/final stabilization.
- Vertex/Gemini Structured Outputs for a closed reviewed-lane intent candidate or `unsupported`.
- Private Cloud Storage reviewed assets, Firestore aggregate events, Secret Manager, Cloud Run, and a constrained daily operations report.
- Hand Talk for Devs JavaScript SDK pinned to `https://api-cdn.handtalk.me/sdk/1.0.0/ht-api-sdk.min.js`, enabled only by an authorized browser token.
- Server-owned reviewed-catalog rules, withdrawal checks, short-lived URLs, staff confirmation, failure fallbacks, and transcript-free application telemetry.

Hand Talk's [quick start](https://api-docs.handtalk.me/v1/en/javascript/getting-start) documents token-based browser initialization. Its [release-channel guidance](https://api-docs.handtalk.me/v1/en/javascript/release-channels) documents fixed versions and channel-specific tokens. Those documents establish an integration interface—not independent accuracy, privacy, commercial-rights, or uptime evidence.

## Responsible design

For reviewed clips, signing footage, captions, hashes, signer grants, and independent Deaf reviewer decisions bind to an immutable catalog. Withdrawal blocks future URLs without erasing the audit record.

Before any visitor uses the experimental avatar, the release plan requires a separate human-recorded, independently Deaf-reviewed **signed ASL introduction** explaining that the avatar is synthetic, experimental, may be wrong, is not an interpreter, retains captions, can be stopped, and excludes consequential use. The visitor must explicitly opt in and may choose captions, typing, reviewed phrases, or human support instead.

The experimental lane also requires:

- executed vendor commercial terms and an SDK-specific DPA;
- a browser-public token bound to the exact HTTPS production domain and fixed 1.0.0 channel, with separate staging/production credentials, quota/rate/spend caps, alerts, expiry, rotation, and revocation;
- retained SDK release evidence and SHA-256 of the exact bytes used;
- real-browser network/privacy and failure-path testing;
- independent, compensated Deaf ASL expert and user evaluation of the exact provider/version/avatar on unseen inputs;
- a rehearsed kill switch that blanks `HANDTALK_TOKEN`, redeploys, verifies `enabled: false`, and revokes the vendor token.

The [WFD/WASLI avatar statement](https://wfdeaf.org/wp-content/uploads/WFD-and-WASLI-Statement-on-Avatar-FINAL-14032018-Updated-14042018.pdf) is the policy baseline: avatars must not replace qualified interpreters for live, complex, or important communication.

Raw audio and transcript text are processed in memory and excluded from application telemetry. Application non-retention does not establish Google or Hand Talk non-retention; deployed provider settings, contracts, and network behavior must be documented.

## Business model

Proposed pilot offer: **$500 setup and validation plus $99 per location per month**, invoiced outside the application.

Actual paid customer evidence: **REQUIRED**

Actual revenue collected: **REQUIRED**

Actual pilot dates and locations, with consent-safe descriptions: **REQUIRED**

Related-party status and revenue concentration: **REQUIRED**

## Production AI and provider evidence

Production URL: **REQUIRED**

Cloud Run revision and deployment SHA: **REQUIRED**

Executed Google ADC identity, Speech-to-Text recognizer/model, final-only result, and Vertex/Gemini model evidence: **REQUIRED**

Published reviewed catalog version, asset hashes, rights, and independent approvals: **REQUIRED**

Hand Talk contract/DPA, domain-bound token/channel confirmation, SDK 1.0.0 SHA-256/release record, actual provider output, network/privacy inspection, quota/rotation/revocation test, and kill-switch rehearsal: **REQUIRED IF AVATAR IS SHOWN**

Signed introduction asset/hash/rights/independent approval and visitor opt-in evidence: **REQUIRED IF AVATAR IS SHOWN**

Independent compensated Deaf avatar evaluation methodology and results: **REQUIRED IF ANY AVATAR QUALITY CLAIM IS MADE**

## Results

Do not substitute targets for observations. Report reviewed-lane gold-set accuracy, consequential-use fallback recall, speech/candidate/playback latency, accessibility findings, compensated Deaf-user task completion, and severity findings separately from avatar results.

For the avatar, report the exact SDK hash, selected avatar, browser/device, frozen unseen input set, first-motion/completion latency, error rate, provider outages, token/quota behavior, and independent Deaf comprehension/linguistic findings. Include meaning errors and limitations; do not report provider completion as translation accuracy.

Verified results: **REQUIRED**

## Links and media

- Source repository: **REQUIRED PUBLIC URL**
- Production demo: **REQUIRED**
- Under-three-minute video: **REQUIRED**
- Customer or testimonial evidence: **REQUIRED AND CONSENTED**
- Architecture, safeguards, claims, and limitations: see this repository's README and `docs/` directory.

## Suggested tags

`accessibility`, `small-business`, `ASL`, `Deaf`, `captions`, `Gemini`, `Google Cloud`, `Speech-to-Text`, `human-in-the-loop`, `responsible-ai`, `WebGL`

## Final publishing check

Before submission, reconcile every sentence against [`docs/claims-ledger.md`](docs/claims-ledger.md), complete [`docs/release-checklist.md`](docs/release-checklist.md), confirm rights and provider terms, verify model/provider execution evidence, and inspect every canonical URL/media item in a logged-out browser.

If the avatar blockers remain open, keep `HANDTALK_TOKEN` unset, do not show provider footage, and describe only the locally implemented integration target. Never claim unrestricted accurate interpretation or certified interpretation.
