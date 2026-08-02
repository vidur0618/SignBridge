# API safety boundaries

The API can authorize an ASL asset only from a finalized Speech-to-Text utterance, an enum-only Gemini candidate, and a matching staff confirmation. The browser cannot submit an intent or asset to create a candidate.

Typing and manual phrase selection are intentionally **captions-only communication fallbacks** in this release. They do not create a `PendingDecision`, `SignPlan`, signed URL, or claim of ASL translation. A future manual-playback feature would require its own server-owned immutable utterance contract, confirmation event, catalog gate, and Deaf-review acceptance test.

The Google Cloud deployment remains limited to one instance until pending decisions, playback grants, and live concurrency leases are transactional and durable. See `infra/README.md`.
