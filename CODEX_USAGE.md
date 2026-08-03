# How Codex was used

This document gives judges, pilot partners, and reviewers a clear record of how AI-assisted development contributed to SignBridge Reception.

## Role in the project

OpenAI Codex was used as an engineering collaborator to:

- inspect the pre-existing `signbridge-overlay` repository and separate reusable safety ideas from out-of-scope implementation;
- scaffold the TypeScript monorepo, contracts, tests, documentation, and deployment configuration;
- implement and review the bounded transcription, safety-gate, intent-selection, staff-confirmation, catalog, and fallback flows;
- research open-source signing renderers, ASL dataset licenses, vendor options, and Deaf-community guidance;
- add an opt-in Hand Talk for Devs 1.0.0 browser-SDK integration for experimental open-input avatar evaluation;
- identify accessibility, linguistic, privacy, security, commercial-contract, and evidentiary release blockers;
- run local type, unit, build, and browser checks where reported and keep provider claims separate from mock results.

Codex did **not** translate English into ASL, author avatar motion, create signing footage, approve linguistic content, represent a Deaf reviewer, negotiate or execute a Hand Talk contract/DPA, obtain a provider token, authenticate Google ADC, deploy cloud resources, recruit pilot users, collect revenue, or manufacture customer evidence. No Hand Talk output, real Google Speech-to-Text result, or Vertex/Gemini response has yet been observed in this repository.

## Deliberate product boundary

The repository contains two separate lanes:

- **Reviewed phrase lane:** Gemini may choose one server-defined reception intent or `unsupported` after deterministic checks. It has no tools, cannot name an asset, cannot publish content, and cannot cause reviewed playback without staff confirmation. Every releasable ASL clip must be a complete human-recorded utterance approved by an independent Deaf ASL reviewer and bound to exact bytes.
- **Experimental avatar lane:** captions-only is the default. After a site operator records the visitor's choice, explicitly enables avatar mode, confirms one exact finalized or typed message, and passes the server's consequential/name/number gate, that authorized English may be sent from the browser to Hand Talk's fixed 1.0.0 SDK. Hand Talk—not Codex, Gemini, or SignBridge's catalog—produces the avatar output. That output is not independently reviewed, not certified interpretation, and not established as accurate for unrestricted input.

The avatar lane does not inherit the safety claims of the reviewed phrase lane. English captions remain visible, captions-only mode remains available, and consequential communication must use qualified human support.

## Research and source boundary

Codex used primary sources to set the documentation boundary:

- Hand Talk's [JavaScript quick start](https://api-docs.handtalk.me/v1/en/javascript/getting-start) for browser loading, token initialization, and `translate()`;
- Hand Talk's [release-channel documentation](https://api-docs.handtalk.me/v1/en/javascript/release-channels) for the pinned `1.0.0` asset and token-channel distinction;
- Hand Talk's [SDK introduction](https://api-docs.handtalk.me/beta/en/introduction) for WebGL and 1,000-character limitations;
- the [WFD/WASLI statement on signing avatars](https://wfdeaf.org/wp-content/uploads/WFD-and-WASLI-Statement-on-Avatar-FINAL-14032018-Updated-14042018.pdf) for linguistic and consequential-use limits;
- [SignBLEU](https://aclanthology.org/2024.lrec-main.1289/) for the limits of serial gloss and the need to evaluate concurrent signed-language channels.

Vendor documentation establishes an available interface, not independent evidence of accuracy, privacy, uptime, commercial rights, or fitness for a reception pilot. Codex therefore recorded contract/DPA and compensated Deaf-evaluation blockers instead of converting vendor descriptions into product claims.

## Verification standard

The public [claims ledger](docs/claims-ledger.md) separates implemented behavior, local verification, provider assertion, production observation, quantitative target, and independent human acceptance. The [evaluation plan](docs/evaluation-plan.md) keeps the reviewed and experimental lanes separate. The [release checklist](docs/release-checklist.md) remains authoritative when a demo or submission is prepared and must be updated before launch if it conflicts with the newer hybrid boundary.

## Credentials and external actions

Codex did not execute an unreviewed downloaded credential script. Google client libraries are expected to use authorized Application Default Credentials supplied by the operator or Cloud Run service identity. The Hand Talk token must be obtained under contract and is delivered to the authenticated browser because the vendor SDK requires it; it is never treated as a private server-only secret. No token, ADC identity, or provider output is claimed until a dated smoke-test record exists.

## Pre-existing work

The provenance and selective-porting record is in [`PREEXISTING_ASSETS.md`](PREEXISTING_ASSETS.md). No pre-existing signing media, corpus, vendor credential, commercial right, or reviewer approval is included in this repository.
