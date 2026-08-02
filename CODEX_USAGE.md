# How Codex was used

This document gives judges, pilot partners, and reviewers a clear record of how AI-assisted software development contributed to SignBridge Reception.

## Role in the project

OpenAI Codex was used as an engineering collaborator to:

- inspect the pre-existing `signbridge-overlay` repository and separate reusable safety ideas from out-of-scope implementation;
- scaffold the TypeScript monorepo, contracts, tests, documentation, and deployment configuration;
- implement and review the bounded transcription, safety-gate, intent-selection, confirmation, catalog, and fallback flows;
- identify accessibility, privacy, security, and evidentiary release gates;
- run local type, unit, build, and browser checks and report their actual outcomes.

Codex did **not** translate English into ASL, create signing footage, approve linguistic content, represent a Deaf reviewer, sign a release, recruit pilot users, deploy cloud resources, collect revenue, or manufacture customer evidence. Those activities require named humans, authorized accounts, and retained records.

## Deliberate AI boundary

In the product, Gemini may choose one server-defined reception intent or `unsupported` from a closed schema after deterministic safety checks. It has no tools, cannot name an asset, cannot publish content, and cannot cause playback without staff confirmation. A failure or deterministic fallback is never recorded as a Gemini execution.

All ASL shown by a releasable catalog must be a complete human-recorded utterance whose exact bytes have been approved by an independent Deaf ASL reviewer. The software cannot concatenate signs, synthesize fingerspelling, animate an avatar, or infer a new signed sentence.

## Verification standard

The public claims ledger in [`docs/claims-ledger.md`](docs/claims-ledger.md) separates implemented behavior, local verification, production observation, quantitative targets, and human acceptance. The release checklist in [`docs/release-checklist.md`](docs/release-checklist.md) remains authoritative when a demo or submission is prepared.

## Pre-existing work

The provenance and selective-porting record is in [`PREEXISTING_ASSETS.md`](PREEXISTING_ASSETS.md). No pre-existing signing media or approvals are included in this repository.
