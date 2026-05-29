# Runtime Stages

Date: 2026-05-29

Projection-stage boundaries. Stages A–D and F are largely closed; the active work
is in Stage E (the chat process), classified by blocker in
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

## Stage E: Generation, Prompt, And Memory — ACTIVE

Three boundaries, gated differently (see [`plan.md`](plan.md)):

- **Provider dispatch** — server-owned in Fastify mode (platform-gated, no flag);
  unsupported shapes fail explicitly. Closed for supported providers (A3 is a
  support cap, not a leak).
- **Prompt assembly** — gated by `useServerPromptAssembly` (default off), so the
  browser still assembles by default. With the flag on,
  `resolveServerPromptAssembly` makes the supported subset server-mandatory and
  hard-fails unsupported content. The remaining **A1** port target is the
  image-gen instruction; multimodal/asset inlining and non-interactive Lua
  edit/input hooks are ported.
- **Post-generation + persistence** — client-orchestrated after the server
  stream. C-A1 is done: `/generate/chat` persists assembly-time scriptstate.
  Blocker **A2** remains: the output trigger (no server `'output'` invocation)
  and `editoutput` derive durable state with no server path. B1/B2 branches stay
  in the browser.
- **HypaV3 memory** — server-side persistence and jobs; progress UI is a
  transient browser projection.

Migration target: each batch names a source branch, the server contract, and the
proof the local fallback is gone. **Group chat is legacy** (Stage E does not model
it) and is slated for client removal — see
[`unsupported-and-client-owned.md`](unsupported-and-client-owned.md).

## Stage F: Audit And Closeout — partial

Assert projection invariants structurally; keep findings from becoming one-off
fixes; record verification after runtime changes. Audit fixture reproducibility is
done (21 rules, 45 tests), but rule robustness is open — four rules were
empirically defeated by sincere refactors. See [`status/audit.md`](status/audit.md).
