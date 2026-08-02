# Linguistic safety contract

## Product language

Approved wording:

> AI-selected, human-recorded, Deaf-reviewed ASL phrase with English captions.

Prohibited wording includes “universal sign language,” “certified interpretation,” “automatic interpreter,” and “word-for-word ASL.” ASL is a natural language with its own grammar, spatial structures, and non-manual signals. An English caption, intent label, or gloss is not an ASL translation.

## Authority

- A Deaf native or highly fluent ASL signer produces the complete utterance.
- A separate qualified Deaf ASL reviewer has final authority over meaning, grammar, regional fit, facial and body grammar, framing, timing, and playback presentation.
- Approval binds to the exact SHA-256 media bytes and catalog version.
- Engineering may not create, splice, mirror, crop, retime, or infer signing.
- Gemini can select only an enumerated intent. It cannot approve, publish, or invent an asset.

## Unsupported content

Names, numbers, acronyms, unconstrained directions, ambiguous utterances, and content involving emergencies, medicine, law, security, money, identity, employment rights, or other consequential decisions fall back to final English captions, typing, manual phrase selection, or the pilot site's established communication-support process.

If ASR does not emit a final result, the system must not classify the last partial result. If Gemini is unavailable, malformed, slow, or uncertain, the system must not use a glossary or substring matcher.

## Presentation

- Preserve face, hands, torso, signing space, aspect ratio, and original orientation.
- Render with `object-fit: contain`; never mirror the video.
- Keep the finalized English caption visible throughout playback.
- Replay and pause are available. Playback is 1× unless the reviewer approves another exact rate.
- Captions-only mode remains available before, during, and after every failure.

The product is not approved for medical, legal, emergency, security, financial, employment-rights, or other high-stakes interpreting.
