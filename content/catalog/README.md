# SignBridge phrase catalog

`catalog.v1.draft.json` is intentionally **non-playable**. It defines the ten
bounded reception meanings, but contains no ASL translation, video, signer,
reviewer, rights claim, or approval claim.

A Deaf signer and an independent Deaf ASL reviewer own the language decisions.
Engineering must not turn the English descriptions in this catalog into ASL,
glosses, isolated-sign sequences, or synthetic signing.

Before a catalog can be published, each intent needs one complete, muted MP4
utterance at exactly 1920x1080, 30 fps, encoded as H.264. The manifest must bind
that file's exact SHA-256 digest to:

- a consent-safe signer reference;
- an independent reviewer reference, distinct from the signer reference, and a
  review timestamp;
- the exact immutable catalog version;
- a rights reference covering every use enumerated by the contracts package;
- either an existing repository-relative file or explicit immutable GCS object
  metadata; and
- `playable: true` only after every preceding check succeeds.

The repository verifier checks the manifest, exact local bytes and SHA-256, and
uses `ffprobe` to inspect every playable local file's codec, dimensions, frame
rate, and absence of audio streams. Install FFmpeg or set `FFPROBE_PATH` before
verifying a playable local catalog. A zero-asset draft does not require it.
Before production publication, the release process must separately verify that
the declared immutable GCS generation exists; manifest metadata alone is not
remote-object evidence.

Run `pnpm catalog:verify` after any catalog or media change. Withdrawal creates
a retained audit record and immediately requires `playable: false`; never edit
a previously published version in place. Runtime URL issuance must also consult
the append-only `AssetRevocationRegistrySchema`, so withdrawal can block an old
immutable catalog snapshot before a replacement catalog is published.
