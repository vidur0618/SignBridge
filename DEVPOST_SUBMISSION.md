# Devpost submission draft

> **Status: evidence template, not a completed submission.** Replace every `REQUIRED` field with verified production or customer evidence. Delete any claim that cannot be substantiated before publishing.

## Project name

SignBridge Reception

## One-line description

A staffed front-desk communication aid designed to use production AI to select human-recorded, Deaf-reviewed ASL phrases while always showing English captions.

## Category

Small Business Services

## The problem

Front desks often lack a fast, respectful way to begin a bounded interaction with a Deaf ASL user. Generic captioning can help, but it does not provide signed reception phrases; ad-hoc automatic signing can introduce serious linguistic and safety risk.

## What it does

Staff press and hold to capture a short English utterance or upload a short audio file. SignBridge shows provisional and final English captions, rejects consequential or out-of-domain content, and asks Gemini to choose from a closed set of ten reception intents. Staff must confirm the candidate. Only then may the product retrieve one exact, human-recorded, independently Deaf-reviewed ASL clip from a hash-bound catalog. Captions remain visible during playback. Typing, manual phrase selection, captions-only communication, and human support are always available.

It is not an interpreter, an emergency service, or general English-to-ASL translation. It does not generate signs, concatenate isolated signs, use an avatar, or replace a qualified interpreter.

## How it is built

- React and Vite reception interface with keyboard, reflow, reduced-motion, and forced-colors support.
- Fastify REST/WebSocket service and shared runtime-validated TypeScript contracts.
- Google Cloud Speech-to-Text V2 for English speech transcription.
- Gemini `gemini-3.6-flash` Structured Outputs for one enum-only intent candidate or `unsupported`.
- Private Cloud Storage assets, Firestore aggregate events, Secret Manager, Cloud Run, and a constrained daily operations report.
- Server-owned safety rules, catalog validation, withdrawal checks, short-lived URLs, mandatory staff confirmation, and content-free telemetry.

## Responsible design

The exact signing footage, captions, hashes, signer grant, and independent Deaf reviewer decision are bound to an immutable catalog version. Withdrawal blocks future playback without erasing the audit record. Audio is processed in memory and discarded; the application does not persist raw audio or transcript text in its telemetry.

## Business model

Pilot offer: **$500 setup and validation plus $99 per location per month**, invoiced outside the application.

Actual paid customer evidence: **REQUIRED**

Actual revenue collected: **REQUIRED**

Actual pilot dates and locations (with consent-safe descriptions): **REQUIRED**

## Production AI evidence

Production URL: **REQUIRED**

Cloud Run revision and deployment SHA: **REQUIRED**

Executed Speech-to-Text and Gemini model evidence: **REQUIRED**

Deployed catalog version and asset hashes: **REQUIRED**

## Results

Do not substitute targets for results. Report the measured gold-set accuracy, high-stakes fallback recall, caption/finalization latency, playback reliability, accessibility findings, compensated Deaf-user task completion, and severity findings here: **REQUIRED**

## Links and media

- Source repository: **REQUIRED PUBLIC URL**
- Production demo: **REQUIRED**
- Under-three-minute video: **REQUIRED**
- Customer or testimonial evidence: **REQUIRED AND CONSENTED**
- Architecture, safeguards, and limitations: see this repository's README and `docs/` directory.

## Suggested tags

`accessibility`, `small-business`, `ASL`, `Deaf`, `Gemini`, `Google Cloud`, `Speech-to-Text`, `human-in-the-loop`, `responsible-ai`

## Final publishing check

Before submission, reconcile every sentence against [`docs/claims-ledger.md`](docs/claims-ledger.md), complete [`docs/release-checklist.md`](docs/release-checklist.md), confirm all media rights, and verify the canonical URLs in a logged-out browser.
