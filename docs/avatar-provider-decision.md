# Experimental avatar provider decision

**Decision date:** 2026-08-02

**Status:** integration target selected; no provider authenticated or approved for customer traffic

## Decision

Keep **Hand Talk for Devs 1.0.0** as the first browser integration target because
its documented JavaScript SDK supports ASL (`en-ase`), WebGL rendering, direct
translation calls, and interactive pause, replay, stop, and qualitative speed
controls. A fixed browser release also avoids the video-generation wait and media
storage of an MP4-per-turn service.

This is not a production selection yet. Hand Talk's official
[quick start](https://api-docs.handtalk.me/v1/en/javascript/getting-start) requires a
token supplied through a contract. No self-service token, public price, executed
commercial agreement, DPA, measured latency, provider output, or independent ASL
evaluation is recorded. The token must remain disabled for customer traffic until
those gates close.

## Alternatives reviewed

| Provider | Current evidence | Decision |
|---|---|---|
| [Sign-Speak](https://app.theneo.io/sign-speak/sign-speak-api/api-specifications/asl-production) | Text-to-ASL API documentation and a developer portal make it the strongest same-day server-video smoke-test candidate. Public [customer terms](https://sign-speak.com/legal/customer) do not authorize the intended embedded commercial pilot, and its blocking video path may take up to 30 seconds. | Technical evaluation alternate only after account access; require an enterprise agreement and DPA before customer text. |
| [Signapse SignStream](https://www.signapse.ai/signstream-api) | ASL generation and public [usage pricing](https://www.signapse.ai/signstream-pricing), but API credentials require vendor contact. The vendor describes experimental output and warns about inaccuracies. | Useful comparison benchmark, not the primary reception dependency. |
| [SignAccess AI](https://www.signaccess.ai/pricing) | Public per-minute tiers and advertised business API access, but no self-service API documentation or credential path was found. | Sales-led alternate; no advantage for the immediate build. |
| [Migam.ai](https://www.migam.ai/) | Early partner/demo positioning without production credential, pricing, or SLA evidence. | Not suitable for this pilot timeline. |

No evaluated vendor establishes unrestricted, accurate English-to-ASL interpretation.
The [WFD/WASLI avatar statement](https://wfdeaf.org/wp-content/uploads/WFD-and-WASLI-Statement-on-Avatar-FINAL-14032018-Updated-14042018.pdf)
supports bounded use, Deaf participation, captions, and access to human support.

## Cost decision

The available Google Cloud credits apply to Speech-to-Text, model classification,
Cloud Run, Firestore, Storage, and related Google services; they do not establish or
pay an unquoted avatar-vendor contract. Keep the two budgets separate.

The vendor portion cannot be forecast honestly until the chosen vendor supplies:

- contracted unit price and minimum commitment;
- staging versus production token costs;
- included volume, overage, concurrency, and rate limits;
- support/SLA and DPA costs;
- retention/deletion and regional-processing options;
- contest/demo/publicity rights.

For each quote, compare the same workload:

```text
monthly provider cost
  = fixed platform fee
  + (completed avatar seconds or requests × contracted unit price)
  + overage/support charges
```

Do not insert zero for an unknown fee. Record vendor quotes as private evidence, and
report estimates separately from invoices and observed usage.

## Go/no-go evidence

Before enabling any provider for a pilot, retain a contracted domain-bound token,
allowed origins, fixed SDK or model version, SDK hash/release record, DPA, quota and
spend controls, sanitized network trace, real Chrome and Edge output, cold/warm
latency, control behavior, failure fallback, and independent compensated Deaf ASL
review on a frozen unseen input set. Provider animation or request completion is not
meaning-accuracy evidence.
