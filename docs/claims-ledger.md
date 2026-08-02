# Public claims ledger

| Claim | Current status | Evidence required before changing status |
| --- | --- | --- |
| Microphone and upload interface flows work locally | Locally verified with browser and provider mocks on 2026-08-01 | Real microphone, uploaded-audio, and provider smoke tests on the named production revision |
| Google Cloud Speech-to-Text runs in production | Not deployed | Cloud revision, successful real invocation, and provider log |
| Gemini selects bounded intents in production | Not deployed | Actual model invocation record and schema-valid output |
| ASL phrases are human-recorded and Deaf-reviewed | Blocked | Exact media, signer grant, independent reviewer decision, and hashes |
| Product has an accessible local interface | Partially verified: 19 Chrome and 19 Edge E2E checks passed, including zero serious or critical Axe findings, keyboard operation, 320 px reflow, 200% equivalent zoom, forced colors, and reduced motion | Manual NVDA checks, exact pilot-laptop verification, exact playable-media checks, independent reviewer acceptance, and compensated Deaf-user evidence |
| Product is market-ready | Not established | Paid pilot, release gates, support process, security review, and production evidence |
| Application-owned storage and logs do not retain raw audio or transcript text | Implemented and covered by local code/tests; production boundary unverified | Deployed telemetry, provider configuration, log-sink review, expiry/TTL verification, and pilot audit |

The same named build passed TypeScript checking, 87 unit tests, catalog validation, web/API production builds, and a production dependency audit with zero critical/high advisories on Windows on 2026-08-01. One moderate transitive `uuid` advisory remains in the Google Cloud Storage dependency tree. The browser tests use controlled WebSocket, microphone, upload, and playback routes; they are failure-path and interface evidence, not proof of real Google Cloud execution or human linguistic acceptance. Linux CI is configured but has not run in this new, unpushed repository.

Claims must distinguish implemented behavior, local verification, production observation, estimate, target, and human acceptance.
