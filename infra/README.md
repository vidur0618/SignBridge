# Google Cloud deployment boundary

These files configure a Cloud Run deployment; they do not claim that a Google Cloud project, billing budget, signer agreement, review, customer, or deployment already exists.

> [!CAUTION]
> This release is intentionally limited to **one Cloud Run instance**. Pending confirmations, playback grants, and the per-site live counter are process-local and therefore do not yet satisfy the planned three-instance availability gate. Session affinity does not make process memory durable. Do not raise `--max-instances` until those three controls use transactional Firestore state and have restart/failover tests.

Before the first build, an operator must:

1. Create a project and billing budget/alerts, then enable Cloud Run, Cloud Build, Artifact Registry, Speech-to-Text, Vertex AI, Firestore, Cloud Storage, Secret Manager, and Cloud Scheduler.
2. Create `signbridge-runtime` and `signbridge-scheduler` service accounts. Grant the runtime only Speech client, Vertex AI user, Datastore user, Secret Manager accessor for the three named secrets, and object viewer/signed-URL permissions for the one private bucket.
3. Create the three secrets referenced in `cloudbuild.yaml`, a private uniform-access bucket, a Firestore Native database, and an Artifact Registry repository.
4. Replace all `change-me` substitutions. `APP_ORIGIN` must be the exact staging custom-domain origin and is also the scheduled-job OIDC audience; never use `*`.
5. Publish a rights-cleared, exact-hash-reviewed catalog and change `SIGN_CATALOG_PATH` only after its validation succeeds. The tracked draft disables all playback.
6. Run `configure-firestore-ttl.ps1` and verify that the `usageEvents.expiresAt` TTL policy is enabled. `EVENT_RETENTION_DAYS` controls the timestamp written by the API; it does not enable Firestore TTL by itself.
7. For any environment that enables the daily job, run `configure-scheduler.ps1` with the same origin used for that service's `APP_ORIGIN`. The service already receives that exact value as `INTERNAL_OIDC_AUDIENCE`. After production promotion, update the job to the production origin.

`cloudbuild.yaml` targets `signbridge-reception-staging` by default and the container build runs the full repository verification gate. Rehearse that exact commit and catalog in staging. Resolve its immutable Artifact Registry digest, then run `promote-production.ps1` with that digest and the verified commit SHA; the script deploys the same bytes to the production service and prints the resulting URL, revision, and image. Do not promote by a mutable tag.

The service processes audio and transcript text in memory only. Firestore receives closed, privacy-safe event fields and immutable operations reports; application logs redact cookies and authorization and never log request bodies. Each usage event receives a Firestore `Timestamp` named `expiresAt`; retention is enforced only after the operator enables the collection-group TTL policy. Session affinity supports the short-lived in-memory confirmation flow, but clients must treat an expired/missing pending decision as captions-only.

The pilot deployment intentionally sets `--max-instances=1`, so the in-process `MAX_LIVE_SESSIONS_PER_SITE` guard is a real service-wide limit. Do not raise the instance count until live-session leases use a distributed Firestore counter; an in-memory guard on three instances would permit up to three times the configured per-site value.
