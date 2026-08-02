# Security policy

SignBridge Reception is currently a bounded pilot build. Do not use it for emergencies or consequential communication.

## Reporting a vulnerability

Report security or privacy concerns privately to the project owner and include the affected revision, route or control, environment, reproducible steps using synthetic data, impact, and suggested mitigation. Do not include real visitor audio, transcript text, credentials, cookies, signing agreements, or payment records.

Until a private reporting address is published, do not open a public issue containing exploit details. The pilot operator must document a private contact before production launch.

## Response

A suspected confirmation bypass, unauthorized signing asset, catalog integrity failure, credential disclosure, or sensitive-data retention is severity 1. Disable the affected capability, use captions/typing or human support, revoke exposed credentials, and preserve only privacy-safe technical evidence. Content corrections require new immutable asset and catalog versions plus independent Deaf review.

## Production prerequisites

Production requires same-origin access, secure HttpOnly session cookies, workload identity or Secret Manager, least-privilege service accounts, private object storage, short-lived signed URLs, size/duration/rate/concurrency limits, content-free logs and Firestore events, budget alerts, dependency and container scanning, and a completed release checklist.
