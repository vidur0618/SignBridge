# Accessibility design and acceptance

The primary audience includes Deaf ASL users, but the product must also work for staff and visitors with low vision, motor disabilities, cognitive disabilities, and assistive technology. “Made for Deaf users” is not a substitute for accessible implementation or paid Deaf-user research.

## Interaction contract

- Every flow has a visible text path. Speech, signing video, color, motion, or sound is never the only way to receive information.
- Microphone capture is a deliberate press-to-start and press-to-stop action with text, icon-independent status, elapsed time, and a hard 15-second stop. Focus is not trapped or moved on every transcription update.
- Provisional text is visibly labeled and may change. It is not announced token by token. A concise polite live region announces only meaningful state changes such as final caption availability, fallback, candidate readiness, or error.
- Finalized captions remain visible through confirmation and the complete video. They are not obscured by controls or replaced by a model label.
- Staff confirmation names both the finalized English caption and the bounded intent description. Playback never starts on focus, classification, page load, or reconnect.
- All actions are native buttons, links, inputs, and dialogs or have equivalent semantics, names, focus management, and keyboard behavior.

## Signing presentation

- Use the complete reviewed video at its natural speed. Do not crop, mirror, loop automatically, place text over the signing space, or replace the signer with a poster or animation.
- Preserve aspect ratio with `object-fit: contain`; keep face, torso, hands, and signing space visible at all supported viewport sizes.
- Pause and replay are always available. A 0.75× control is absent unless the independent reviewer approves every exact clip at that rate and the catalog records that approval.
- A failed, withdrawn, missing, corrupt, or expired asset returns to the same caption/typing/manual-support surface without implying that signing was shown.

## Visual and cognitive design

- Minimum target size is 44 by 44 CSS pixels with adequate separation.
- Text and meaningful controls meet WCAG contrast requirements in default and focused states; meaning is never encoded by color alone.
- The single-screen layout reflows to 320 CSS pixels and remains usable at 200% browser zoom without two-dimensional scrolling, except inside an intrinsically wide data table.
- System text sizing and forced-colors mode remain functional. Focus indicators use system-compatible outlines.
- Reduced-motion preference disables non-essential transitions. No flashing, auto-advancing content, parallax, or timed disappearance is used.
- Error messages identify the affected control and an actionable fallback in plain language. Safety limits are stated before capture, not only after rejection.

## Manual release matrix

Run the exact production build in the pilot environment and retain dated evidence for:

| Check | Required environments |
| --- | --- |
| Keyboard-only completion and visible focus | Current Chrome and Edge |
| Screen reader labels, landmarks, status announcements, and errors | NVDA with Chrome or Edge; document versions |
| 320 px reflow and 200% zoom | Current Chrome and Edge |
| Windows forced colors | Edge |
| Reduced motion | Browser and operating-system preference enabled |
| Microphone allowed, denied, disconnected, and timed out | Pilot laptop and microphone |
| Video containment, captions, pause, replay, expiry/failure | Every approved asset class |
| Bounded-task comprehension | Independent reviewer plus three to five compensated Deaf ASL users |

Automated checks may catch regressions, but only the manual and human checks above can close the corresponding release gates.
