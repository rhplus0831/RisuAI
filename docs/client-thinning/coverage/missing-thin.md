# Missing Or Thin Coverage

Date: 2026-05-30

Active gaps after the A-item implementation, framed by the blocker classification
in [`../plan.md`](../plan.md).

## Resolved Hard Blockers

- **A1 prompt-assembly content parity** — classifier, text-send server-mandatory
  routing, C-A1, multimodal/asset inlining on image-input models,
  non-interactive Lua edit/input hooks, and the image-gen instruction are
  landed. Non-vision image caption fallback, interactive Lua dialog APIs, and
  pluginV2 edit/replacer hooks are explicit `unsupported`. The flag now defaults
  true, so server assembly is the default Fastify path.
- **A2 post-generation durable derivation** — landed on the server-dispatch path:
  `runServerPostGeneration` runs the run-var pass, the `'output'` trigger, and
  `editoutput`; the route persists the scriptstate delta and returns final text /
  resend / revision on `done.postGeneration`.

## Open (Separate / Not A-Blockers)

- **Durable/resumable generation** — still separate and not achieved: `/chat`
  aborts on disconnect and final-result persistence remains browser-command
  backed.
- **A2 derivation failure policy** — success-path A2 is landed. Closeout decision
  #2 accepts current best-effort behavior: `buildPostGenerationFrame` swallows
  server post-generation derivation failures and there is no browser fallback on
  the server-dispatch path. Revisit only with a stricter hard-fail/retry contract.

## Open (Optimizable, B2 — not correctness)

- Final-result persistence via command is handed to the durable-generation
  workstream; route-direct persistence needs that reconnect/read contract.
- Stage timing is browser-measured.

## Open (Other)

- **Audit-rule robustness** — the four empirically defeated rules are hardened;
  some other rules remain shallow and should only become work after a sincere
  defeat is demonstrated. See [`../status/audit.md`](../status/audit.md).
- **Group-chat residual cleanup** — UI branches are removed. Remaining work is the
  exact cleanup of stale strings/comments; `Message.saying` and the load-time
  filter are already decided keep; see
  [`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md).

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
