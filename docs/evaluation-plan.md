# Evaluation and release gates

The reviewed phrase lane and experimental Hand Talk lane require separate reports. Passing one lane never validates the other.

## Shared speech and fallback set

Build at least 100 authorized or synthetic English recordings: eight paraphrases for each of ten supported reviewed intents plus at least twenty ambiguous, out-of-domain, name/number-heavy, malicious, and consequential-use cases. Include multiple speakers and moderate front-desk noise. Synthetic audio is test evidence, not customer or Deaf-user evidence.

Shared technical gates:

- no partial Speech-to-Text result can create a reviewed candidate or avatar request;
- quiet-condition WER at most 15% and moderate-noise WER at most 25%;
- P95 first visual partial caption under 750 ms and final transcript after stop under 1.5 seconds;
- captions-only mode makes no Hand Talk request;
- finalized captions stay visible throughout reviewed video or avatar playback;
- SDK, WebGL, token, provider, timeout, and playback failures leave an understandable caption and support path;
- no serious or critical automated accessibility result and no high or critical security finding.

Report results against a named commit, deployed revision, browser, device, network, Google Speech model/recognizer, Hand Talk fixed SDK URL, token environment, selected avatar, dataset, and date. Configuration values and mocks are not provider-execution evidence.

## Reviewed phrase lane

Automated gates:

- supported-intent candidate accuracy at least 95% on the frozen gold set;
- consequential-use and explicit out-of-domain fallback recall 100%;
- zero reviewed ASL playback without staff confirmation;
- P95 final transcript to candidate under 2.5 seconds;
- warm confirmed playback onset under 500 ms and completion success at least 99%;
- withdrawn, unapproved, corrupt, or hash-mismatched assets never receive a URL.

Human gates:

- an independent Deaf ASL reviewer approves every exact asset and presentation;
- three to five compensated Deaf ASL users complete at least 90% of the bounded reception tasks;
- no severity-1 meaning error, harmful omission/addition, incorrect non-manual grammar, crop, mirror, or wrong-context playback;
- corrections create a new hash and catalog version; a reported bad translation immediately withdraws the affected asset.

## Experimental Hand Talk lane

The avatar lane cannot inherit the ten-phrase review. Before any customer pilot, obtain an authorized commercial token and completed contract/DPA, then test the exact fixed SDK and provider output. Include both the ten bounded reception meanings and a larger unseen open-input set covering paraphrases, negation, questions, tense/aspect, pronouns, spatial reference, classifiers, fingerspelling, names, numbers, acronyms, regional variants, long input, unsupported concepts, and adversarial text.

Technical/provider gates:

- verify the official 1.0.0 script loads only from the pinned HTTPS URL on current Chrome and Edge with WebGL;
- prove that captions-only is the default, configuration/token retrieval is deferred until explicit session activation, draft creation never contacts the provider, and only a single-use `play` decision for a server-owned draft releases its canonical text to the browser SDK;
- prove 100% fallback recall for the avatar consequential, prompt-injection, name, and number cases in the frozen negative set, with no SDK load or provider call;
- reconcile each provider start/completion/failure with its signed authorization ID and transcript-free event record;
- record provider request success/failure, first-motion latency, completion, pause, resume, repeat, stop, speed, reload, token expiry, quota, offline, and revocation behavior;
- inspect browser network traffic for the actual provider origins and document submitted data, telemetry, cookies/storage, and error payloads;
- verify the contracted token is origin-restricted, separately scoped for staging/production, rotatable, revocable, and absent from Git/logs/screenshots;
- verify captions remain available if the provider rejects a message or renders no usable output.

Independent linguistic evaluation must be conducted by compensated Deaf ASL experts and users who are not the provider or engineering team. Score:

- meaning preservation, omissions, additions, ambiguity, and pragmatic force;
- ASL syntax, lexical selection and regional fit;
- handshape, orientation, location, movement, fingerspelling, and coarticulation;
- facial/non-manual morphology and prosody;
- spatial loci, agreement, role shift, and classifier constructions;
- naturalness, comprehensibility, cultural appropriateness, avatar legibility, occlusion, framing, and motion artifacts.

Use blinded comprehension questions and task completion on unseen input, plus severity-rated error review. A successful animation, vendor completion event, English back-translation, pose metric, gloss metric, or engineering inspection cannot establish ASL accuracy. [SignBLEU](https://aclanthology.org/2024.lrec-main.1289/) may support regression testing of multi-channel representations but does not replace human acceptance.

The [WFD/WASLI avatar statement](https://wfdeaf.org/wp-content/uploads/WFD-and-WASLI-Statement-on-Avatar-FINAL-14032018-Updated-14042018.pdf) is the release-policy baseline: the open-input avatar must not replace a qualified interpreter for live, complex, or important communication. Emergencies, medicine, law, security, payments, identity, employment rights, and other consequential uses remain out of scope regardless of measured average accuracy.

## Current status

As of 2026-08-02, no Hand Talk token or generated output, Google ADC identity, live Speech-to-Text response, or Vertex/Gemini response has been tested. No avatar accuracy, latency, privacy, availability, or commercial-readiness metric is achieved. The reviewed catalog has no approved signing assets. All thresholds in this document remain targets until a dated evidence package records actual observations.
