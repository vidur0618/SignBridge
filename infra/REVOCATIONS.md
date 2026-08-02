# Runtime asset revocation

Published catalogs are immutable. Emergency withdrawal is therefore a separate, append-only runtime gate checked immediately before every signed URL is created.

In Google Cloud mode, create a Firestore document at:

`assetRevocations/{assetId}--{sha256}`

The document ID is the enforcement key. Its body must contain `assetId`, `assetSha256`, `catalogVersion`, `withdrawnAt`, and a consent-safe `withdrawalRef`; never delete or reactivate it. The runtime only needs document-read access to this collection. A catalog correction must publish a new asset hash and catalog version.

In local mode, `SIGN_REVOCATION_PATH` can point to an `AssetRevocationRegistry` JSON object (`schemaVersion: 1`, `immutableEntries: true`, `updatedAt`, and `entries`). The file is reread for every decision. No configured file means an empty local registry; it does not imply that any asset is approved.
