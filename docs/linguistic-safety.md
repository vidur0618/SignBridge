# Linguistic safety contract

## Two assurance levels

Approved wording for the reviewed catalog lane:

> AI-selected, human-recorded, independently Deaf-reviewed ASL phrase with English captions.

Approved wording for the open-input lane:

> Experimental synthetic ASL avatar from Hand Talk, with the finalized English caption always visible. Output may be wrong and is not certified interpretation.

Never describe either lane as a “universal sign language,” “automatic interpreter,” “certified interpretation,” “word-for-word ASL,” or unrestricted accurate English-to-ASL translation. Do not transfer the review status of a human-recorded catalog asset to provider-generated avatar output.

ASL is a natural language with its own grammar, spatial structures, concurrent manual and non-manual signals, discourse, and regional variation. An English caption, intent label, gloss sequence, JSON structure, or plausible avatar motion is not evidence of an accurate ASL translation.

The [World Federation of the Deaf and World Association of Sign Language Interpreters statement](https://wfdeaf.org/wp-content/uploads/WFD-and-WASLI-Statement-on-Avatar-FINAL-14032018-Updated-14042018.pdf) explains why word-for-sign substitution is inadequate and warns against replacing qualified interpreters with avatars for live, complex, or important communication. Its narrow acceptance of pre-recorded static customer information developed with Deaf participation supports the reviewed phrase lane; it does not validate unrestricted avatar output.

## Reviewed phrase authority

- A Deaf native or highly fluent ASL signer produces each complete utterance.
- A separate qualified Deaf ASL reviewer has final authority over meaning, grammar, regional fit, facial and body grammar, framing, timing, and playback presentation.
- Approval binds to exact SHA-256 media bytes and an immutable catalog version.
- Engineering may not create, splice, mirror, crop, retime, or infer signing.
- Gemini may select only an enumerated intent. It cannot approve, publish, or invent an asset.
- Every supported candidate requires staff confirmation before a reviewed clip can play.

The current catalog contains ten intent definitions and no approved signing assets. No reviewed ASL playback is currently available.

## Experimental Hand Talk lane

The opt-in Hand Talk for Devs integration sends finalized or typed English text to a third-party browser SDK and renders a WebGL avatar. The provider's [quick start](https://api-docs.handtalk.me/v1/en/javascript/getting-start) documents the token-based `HTApi.translate()` call; the [SDK introduction](https://api-docs.handtalk.me/beta/en/introduction) documents ASL support, WebGL dependence, and a 1,000-character input limit.

These vendor capabilities do not establish linguistic accuracy. Before any market-pilot use, this lane requires:

- executed commercial terms covering ASL, the fixed 1.0.0 SDK channel, allowed origins, contest demonstration, and customer use;
- a DPA and documented text/telemetry retention, deletion, subprocessors, hosting regions, incident notice, token rotation, and support/SLA terms;
- an independent, compensated Deaf ASL linguistic evaluation of the exact provider version, avatar, browser, input set, and presentation;
- a documented stop-ship threshold for meaning errors, omissions/additions, non-manual grammar, spatial reference, classifier construction, fingerspelling, names, numbers, and regional variation;
- clear user notice and a qualified-interpreter or established support path.

No Hand Talk token or output has yet been tested. Until all blockers close, this lane is an evaluation surface—not the production-safe fallback and not evidence of unrestricted interpretation.

## Input and fallback rules

- Provisional ASR text may be displayed but must never be sent for signing. Only an `isFinal` speech result may enter either signing lane.
- Captions-only is the default. Typed text is explicit input and may enter the avatar only after the staff member selects avatar mode, submits it, and confirms that exact message.
- `POST /api/avatar/drafts` blocks consequential, prompt-injection, name-bearing, number-heavy, partial, empty, unsupported-locale, and over-limit input. A separate single-use `POST /api/avatar/drafts/:draftId/decision` request must consume the server-owned canonical draft before the browser may call the provider.
- Captions-only mode sends no text to Hand Talk.
- Provider initialization, authentication, WebGL, timeout, translation, or playback failure leaves the finalized caption visible.
- Names, numbers, acronyms, unconstrained directions, and ambiguous text are not presumed to be signed correctly by the avatar.
- Emergencies, medicine, law, security, money, payments, identity, employment rights, and other consequential decisions use captions plus the site's qualified communication-support procedure—not the avatar.

## Presentation

For reviewed video:

- preserve face, hands, torso, signing space, aspect ratio, and original orientation;
- render with `object-fit: contain`; never mirror the video;
- use 1× speed unless the reviewer approves another exact rate.

For both lanes:

- keep the finalized English caption visible throughout signing;
- provide pause, replay, and stop controls where the provider supports them;
- label the current lane and assurance level in the interface;
- preserve captions-only mode before, during, and after every failure;
- never use visual fluency or successful animation as evidence that the meaning is correct.
