# Missing Or Thin Coverage

Date: 2026-05-29

The active gaps, framed by the blocker classification in [`../plan.md`](../plan.md).

## Open (Hard Blockers)

- **A1 prompt-assembly content parity** — server `/generate/chat` is not at parity
  for multimodal/asset inlining (`prompt/history.ts` `NO_ASSETS`; `inlayAssets`
  unused), image-gen instruction, Lua `editRequest` (identity stub), and
  Lua/plugin-V2 + input-trigger/`editinput` scripts. No `resolveServerPromptAssembly`
  classifier exists; `useServerPromptAssembly` defaults off, so local assembly is
  the production path.
- **A2 post-generation durable derivation** — the output trigger has no server
  path at all (`prompt/triggers.ts` wires only `'start'`), and `editoutput` script
  processing is browser-only.
- The server route is stateless re the chat blob: assembly-time scriptstate is
  replayed by the browser as a command (the **C-A1** batch moves this into the
  route).

## Open (Optimizable, B2 — not correctness)

- Result/scriptstate persistence via command replay could become route-direct
  (closes a small durability window, saves a round-trip).
- Stage timing is browser-measured.

## Open (Other)

- **Audit-rule robustness** — ~12/20 rules are shallow; four were empirically
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
