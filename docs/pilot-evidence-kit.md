# Pilot evidence kit

Keep customer, signer, reviewer, payment, and identity records in an access-controlled system outside Git. This file defines the evidence index without containing private data.

## Release record

| Field | Verified value |
| --- | --- |
| Git deployment SHA | REQUIRED |
| Cloud Run revision and region | REQUIRED |
| Production origin | REQUIRED |
| Catalog version and manifest hash | REQUIRED |
| Exact Speech-to-Text recognizer/model | REQUIRED |
| Exact Gemini model actually executed | REQUIRED |
| Deployment timestamp and release owner | REQUIRED |
| Automated check artifact | REQUIRED |
| Manual Chrome and Edge result | REQUIRED |

## Content record

For each of the ten assets, retain the intent ID, version, exact SHA-256, duration and dimensions, storage object generation, signer reference, rights/grant reference, compensation reference, independent reviewer reference, decision time, approved presentation rates, and withdrawal state. Public material should use consent-safe references only.

## Customer and revenue record

Retain an executed pilot agreement, invoice, payment confirmation, pilot start/end, consent-safe location description, staff training attendance, support contact, production-use evidence, and any explicitly consented testimonial. Revenue means collected payment, not an issued invoice or forecast.

## Measurement record

Preserve the frozen gold-set version and consent/synthetic provenance; environment and speaker/noise labels; expected supported/unsupported outcome; raw evaluation outputs in restricted storage; aggregate accuracy, fallback recall, WER, and latency computation; accessibility tool versions and manual findings; compensated Deaf-user protocol, consent, anonymized task outcomes, and severity decisions.

Targets in the evaluation plan must remain labeled as targets until a dated run against a frozen revision produces results.

## Daily evidence log template

| Date | Code revision | Catalog | Production sessions | Fallback rate | Staff rejection rate | Playback failures | Provider/model calls | Operations run status | Incidents/changes |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED |

The log contains aggregates only. Do not add audio, transcript text, names, phone numbers, badge data, email addresses, access codes, or other interaction content.
