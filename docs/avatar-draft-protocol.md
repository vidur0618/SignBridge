# Server-owned avatar draft protocol

The experimental browser-avatar lane uses two same-origin requests before any provider translation call:

1. `POST /api/avatar/drafts` accepts finalized or explicitly submitted English text, runs the deterministic safety gate, normalizes it, and stores it only in volatile server memory for five minutes.
2. `POST /api/avatar/drafts/:draftId/decision` accepts only `play` or `fallback`. The draft is bound to the authenticated session and consumed exactly once. A `play` response returns the server-owned canonical text and a short-lived authorization ID; `fallback` returns `staff_rejected` and cannot later be replayed.

The decision request contains no text and no browser-supplied `staffConfirmed` assertion. Unknown, expired, forged, cross-session, and already-consumed draft IDs return the same unavailable response. Application events never include draft text.

This protocol narrows the client-bypass surface, but it is not proof that a human clicked the confirmation control. It also cannot force a third-party browser SDK to transmit the authorized text. Provider origin controls, SDK isolation, contractual privacy terms, real network inspection, and independent Deaf ASL evaluation remain release gates.
