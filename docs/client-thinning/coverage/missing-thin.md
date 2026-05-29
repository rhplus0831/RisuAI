# Missing Or Thin Coverage

Date: 2026-05-29

The active gaps, framed by the blocker classification in [`../plan.md`](../plan.md).

## Open (Hard Blockers)

- **A1 prompt-assembly content parity** — classifier, text-send server-mandatory
  routing, C-A1, and multimodal/asset inlining on image-input models are landed.
  Remaining gaps: image-gen instruction and Lua hook wiring (`editRequest`,
  `editprocess`, input-trigger/`editinput`). Non-vision image caption fallback
  and pluginV2 edit/replacer hooks are explicit `unsupported`. The flag still
  defaults off, so local assembly remains the default production path.
- **A2 post-generation durable derivation** — the output trigger has no server
  path at all (`prompt/triggers.ts` wires only `'start'`), and `editoutput` script
  processing is browser-only.
- **Durable/resumable generation** — still separate and not achieved: `/chat`
  aborts on disconnect and final-result persistence remains browser-command
  backed.

## Open (Optimizable, B2 — not correctness)

- Final-result persistence via command could become route-direct (closes a small
  durability window, saves a round-trip).
- Stage timing is browser-measured.

## Open (Other)

- **Audit-rule robustness** — several rules are shallow; four were empirically
  defeated. See [`../status/audit.md`](../status/audit.md).
- **Group-chat legacy removal** — group chat must be removed from the client; not a
  thinning batch. See [`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md).

## Intentionally Thin / Deferred

- Command events are invalidation signals, not patch contracts. **Surgical event
  patching is deferred** until the SSE reconnect/replay gap is closed.
- B1 browser-only effects (notification, TTS, media, emotion store, progress UI,
  input plumbing) and plugin runtime remain client-owned.
- Provider coverage is a subset (A3); unsupported shapes hard-fail explicitly.

## Do Not Use As Proof

- Archived/prose closeout by itself.
- Helper existence without route/helper tests.
- A passing audit rule without fixture/test reproducibility, or a shallow rule
  treated as robust against refactors.
- Local browser fallback behavior in Fastify mode unless a route resolver
  explicitly classifies it unavailable/unsupported.
