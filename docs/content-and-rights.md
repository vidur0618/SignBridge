# Content, consent, and rights gate

No real ASL asset may enter a playable catalog until all rows below are supported by private evidence. This repository stores consent-safe references, not identities or agreements.

## Required evidence per asset

| Evidence | Minimum requirement |
| --- | --- |
| Signer consent | Exact asset hash, intended audience, recording purpose, compensation, retention, and withdrawal procedure |
| Distribution grant | Commercial pilot, hosting, customer playback, contest demonstration, judge access, and any sponsor publicity actually authorized |
| Reviewer decision | Independent reviewer, qualification basis, language/region scope, exact asset hash, exact catalog version, and approval date |
| Rights | Owner, territory, term, hosting, attribution, publicity, editing and derivative-work boundaries |
| Technical | SHA-256, MIME type, duration, dimensions, frame rate, storage object generation, and withdrawal state |

## Publication workflow

1. Create a draft catalog version and immutable intent IDs.
2. Record complete utterances; do not record isolated signs for later concatenation.
3. Export muted H.264 MP4 at 1080p/30 fps without crop, mirror, synthetic background replacement, or retiming.
4. Hash the exact bytes and create private signer, rights, and reviewer records.
5. Add consent-safe references to the draft manifest.
6. Run `pnpm catalog:verify` and the presentation tests.
7. A human release authority changes the exact catalog to `published` only after checking the private evidence.
8. Upload the immutable object and record its Cloud Storage generation.

Corrections create a new asset and catalog version. Withdrawal blocks new signed URLs and new releases; it never erases the audit record or silently changes an earlier session's provenance.

> [!CAUTION]
> The included catalog is intentionally draft and contains no ASL media or approval. It proves the product boundary, not linguistic quality.
