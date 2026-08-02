# Evaluation and release gates

## Gold set

Build at least 100 authorized or synthetic English recordings: eight paraphrases for each of ten supported intents plus at least twenty ambiguous, out-of-domain, name/number-heavy, malicious, and high-stakes cases. Include multiple speakers and moderate front-desk noise. Synthetic audio is test evidence, not user evidence.

## Automated gates

- Supported-intent candidate accuracy at least 95% on the frozen gold set.
- High-stakes and explicit out-of-domain fallback recall 100%.
- Zero ASL playback without staff confirmation.
- Quiet-condition WER at most 15%; moderate-noise WER at most 25%.
- P95 first visual partial caption under 750 ms.
- P95 final transcript after stop under 1.5 seconds.
- P95 final transcript to candidate under 2.5 seconds.
- Warm confirmed playback onset under 500 ms and completion success at least 99%.
- No serious or critical automated accessibility result and no high or critical security finding.

Report measurements as observations from a named build, catalog, dataset, browser, device, network, and date. Do not present these targets as achieved until evidence exists.

## Human gates

- The independent Deaf reviewer approves every exact asset and presentation.
- Recruit three to five compensated Deaf ASL users for bounded task testing.
- At least 90% task completion, with no severity-1 meaning error, harmful omission/addition, incorrect non-manual grammar, crop, mirror, or wrong-context playback.
- Corrected content creates a new hash and catalog version; a reported bad translation immediately withdraws the affected asset until re-approved.

Automated text, gloss, pose, or video metrics cannot replace native-signer comprehension and review.
