# Runtime Stages

Date: 2026-05-30

Projection-stage boundaries. Stages A–D are largely closed; Stage E's A-items are
landed and closeout work is tracked in Stage F. The blocker classification lives in
[`plan.md`](plan.md) and detailed in
[`status/sendchat-thinning.md`](status/sendchat-thinning.md).

## Stage A: Fastify Shell And Bootstrap — closed

Serve the SPA, inject the marker, authenticate `/api/v1/bootstrap`, register
active-writer ownership only for writer-intent bootstrap, return revision/schema/
masked projection/asset base, cache the command revision. Passive refresh stays
read-only.

## Stage B: Browser Projection And Guard — closed

Apply projections through trusted write scopes; the guard prevents ordinary code
from mutating `DBState.db` in Fastify mode. A guard catch is a lead: classify as
command-needed, browser-local, trusted projection write, or legacy/no-port.

## Stage C: Command Mutation Boundary — closed

Validate `baseRevision` (409 on stale), reject stale active-writer (423), validate
ids/ownership, apply one persisted mutation, bump revision once, emit one event,
roll back on failure. New durable writes are command-backed or explicitly an
import/asset/generation/memory route mutation. Composite browser fan-out must
serialize revisions or become one server command.

## Stage D: Event Projection Refresh — closed (patching deferred)

Stream command/memory events; schedule a debounced read-only projection refresh
after command events. Command events are **invalidation** signals, not patch
contracts. Per-event surgical patching stays deferred until a separate event
contract exists; its precondition is closing the SSE reconnect/replay gap (today
a stream error only logs — no reconnect, no `Last-Event-ID` replay).

## Stage E: Generation, Prompt, And Memory — A-items landed

Three boundaries, gated differently (see [`plan.md`](plan.md)):

- **Provider dispatch** — server-owned in Fastify mode (platform-gated, no flag);
  unsupported shapes fail explicitly. Closed for supported providers (A3 is a
  support cap, not a leak).
- **Prompt assembly** — gated by `useServerPromptAssembly` (default on), so
  `resolveServerPromptAssembly` makes the supported subset server-mandatory by
  default and hard-fails unsupported content. The browser assembles locally only
  outside Fastify mode or when a test/specific case opts the flag out. A1 content
  graduation is complete:
  multimodal/asset inlining, non-interactive Lua edit/input hooks, and the
  image-gen instruction are ported; non-vision caption, interactive Lua dialogs,
  and pluginV2 stay explicit `unsupported`.
- **Post-generation + persistence** — the browser still orchestrates effects and
  final-message command persistence. On the server-dispatch path,
  `/generate/chat` persists assembly-time scriptstate and A2 post-generation
  scriptstate deltas, returning final text / resend / revision on
  `done.postGeneration` when derivation succeeds. If that derivation throws,
  `/generate/chat` currently omits the post-generation frame and the browser does
  not run the skipped local derivation. B1/B2 branches stay in the browser.
- **HypaV3 memory** — server-side persistence and jobs; progress UI is a
  transient browser projection.

Closeout target: **group chat is legacy** (Stage E does not model it) and is
slated for client removal — see
[`unsupported-and-client-owned.md`](unsupported-and-client-owned.md).

## Stage F: Audit And Closeout — partial

Assert projection invariants structurally; keep findings from becoming one-off
fixes; record verification after runtime changes. Audit fixture reproducibility is
done (23 checks, 58 tests), and the four empirically defeated rules are now
hardened AST invariants. Some other rules remain shallow and should be hardened
only after a sincere defeat is demonstrated. See [`status/audit.md`](status/audit.md).
