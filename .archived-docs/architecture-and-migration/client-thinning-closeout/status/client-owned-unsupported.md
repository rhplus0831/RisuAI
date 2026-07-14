# Client-Owned, Legacy, And No-Port

Date: 2026-05-29

Detail shard for what stays in the browser, what is legacy, and what is no-port.
The canonical statement is
[`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md); this
shard adds the chat-process specifics.

## B1 — Permanent Client-Owned (keep)

The full keep list lives in
[`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md). The
chat-specific split to remember: slash text, file-inlay insertion, say-nothing
rows, reroll trim, abort, B1 effects, and plugin runtime execution stay browser;
server prompt assembly now owns non-interactive submit-time input-trigger /
`editinput`; interactive Lua dialogs stay explicit `unsupported`.

## B2 — Acceptable, Browser Orchestrates Or Requests (optimizable, not a bug)

- **Auto-continue / resend recursion** — control flow; each iteration's durable
  writes go server-side, so the loop is just re-issuing `sendChat`.
- **Final-message persistence via command** — `dispatchPersistGenerationResult`.
  Requesting a validated, guarded, revision-checked write is a thin pattern.
  Optional later win: route-direct final-result persistence closes a small
  durability window (crash between generation and command) and saves a round-trip.
  Assembly-time scriptstate replay is gone; `/generate/chat` owns that write.
  **Decided 2026-05-30 (decision #7):** route-direct final-message persistence is
  **handed to the durable-generation workstream** — it is out of client-thinning
  closeout scope. Its route-owned assistant-message write, double-write avoidance,
  revision semantics, and reconnect/read behavior are designed there. See
  [`../phases/phase-5-closeout.md`](../phases/phase-5-closeout.md#closeout-decisions-2026-05-30).
- **Stage-timing metadata** — browser-measured wall-clock telemetry, persisted via
  command.

These are not blockers and not violations; they are candidates for later
tightening, not correctness fixes.

## Legacy — Remove From The Client

- **Group chat** — fully legacy as of 2026-05-29. Not "unsupported under server
  assembly": it must not remain usable from the client. The dead `type === 'group'`
  UI branches were removed 2026-05-30 (guarded by `A4R-group-chat-removed`); the
  defense layers and `Message.saying` are kept. Remaining-scope notes and rationale
  are in [`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md).
- The historical no-port list (native/mobile, Tauri/Hono/Express, service workers,
  peer/Drive/Account sync, legacy memory/sync surfaces outside this thinning
  plan, server-side plugin execution, per-event surgical patching without an
  event contract).

## Unsupported (Fail Explicitly)

Unsupported provider shapes fail through `resolveServerCompletionRoute()` with no
browser fallback. This is a support cap (blocker A3), not a thinness leak.

## Rule Of Thumb

If the behavior decides or derives durable state, it needs a server-owned path and
proof. If it only triggers an effect, holds transient state, orchestrates, or
requests a validated write, it may stay in the browser — document why. If it is
legacy, remove it from the client.

## Verification Coverage

The former proof-only coverage shard is consolidated with its canonical status record.

Date: 2026-05-30

Active gaps after the A-item implementation, framed by the blocker classification
in [`../plan.md`](../plan.md).

### Resolved Hard Blockers

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

### Open (Separate / Not A-Blockers)

- **Durable/resumable generation** — still separate and not achieved: `/chat`
  aborts on disconnect and final-result persistence remains browser-command
  backed.
- **A2 derivation failure policy** — success-path A2 is landed. Closeout decision
  #2 accepts current best-effort behavior: `buildPostGenerationFrame` swallows
  server post-generation derivation failures and there is no browser fallback on
  the server-dispatch path. Revisit only with a stricter hard-fail/retry contract.

### Open (Optimizable, B2 — not correctness)

- Final-result persistence via command is handed to the durable-generation
  workstream; route-direct persistence needs that reconnect/read contract.
- Stage timing is browser-measured.

### Open (Other)

- **Audit-rule robustness** — the four empirically defeated rules are hardened;
  some other rules remain shallow and should only become work after a sincere
  defeat is demonstrated. See [`../status/audit.md`](audit.md).
- **Group-chat residual cleanup** — UI branches are removed. Remaining work is the
  exact cleanup of stale strings/comments; `Message.saying` and the load-time
  filter are already decided keep; see
  [`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md).

### Intentionally Thin / Deferred

- Command events are invalidation signals, not patch contracts. **Surgical event
  patching is deferred** until the SSE reconnect/replay gap is closed.
- B1 browser-only effects (notification, TTS, media, emotion store, progress UI,
  input plumbing) and plugin runtime remain client-owned.
- Provider coverage is a subset (A3); unsupported shapes hard-fail explicitly.

### Do Not Use As Proof

- Archived/prose closeout by itself.
- Helper existence without route/helper tests.
- A passing audit rule without fixture/test reproducibility, or a shallow rule
  treated as robust against refactors.
- Local browser fallback behavior in Fastify mode unless a route resolver
  explicitly classifies it unavailable/unsupported.
