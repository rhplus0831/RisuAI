# Client Thinning Status

Date: 2026-05-30

Status router for the Fastify-only client-thinning workstream. The codebase is
the source of truth; detailed inventories live in the shards.

## Current Snapshot

Implemented / closed:

- Fastify-served web mode is the supported runtime; it injects the browser
  marker (`globalThis.__FASTIFY__`) when serving the SPA.
- Durable resource mutation is command-backed for the major resource families
  (`baseRevision`, 409 conflict, single revision bump, command events).
- The active-writer guard protects server-owned mutation routes; the projection
  write guard freezes `DBState.db` outside trusted projection writes.
- Provider dispatch is server-routed in Fastify mode for supported shapes;
  unsupported shapes fail explicitly (no browser fallback).
- `resolveServerPromptAssembly` is landed. With `useServerPromptAssembly` on,
  the supported subset is server-mandatory instead of falling through to local.
- Multimodal/asset prompt inlining is server-side at parity for image-input
  models; non-vision image caption fallback hard-fails as unsupported.
- Image-gen / emotion view instruction assembly is server-side at parity
  (slice 3c); the actual image-generation call and inlay rendering remain B1
  browser effects.
- Assembly-time scriptstate persistence (C-A1) is server-owned by
  `/generate/chat`; the browser applies the patch as projection and reconciles
  the returned revision instead of re-POSTing that delta.
- The server Lua VM and prompt-assembly hooks are landed: `editRequest`,
  `editprocess`, input-trigger, and `editinput` run server-side for
  non-interactive Lua; interactive Lua dialog APIs stay `unsupported`.
- A2 is landed on the server-dispatch path: `runServerPostGeneration` runs the
  run-var pass, `runTrigger(..., 'output', ...)`, and `editoutput`; the route
  persists the derived scriptstate delta and returns final text / resend /
  revision on `done.postGeneration` when derivation succeeds. Derivation errors
  are currently swallowed by `/generate/chat`; the browser does not run a local
  derivation fallback on that path.
- Bootstrap projection, command-event invalidation, `.risu` import/export/bundle,
  asset routes, backup/restore, and provider secret masking are closed.
- The client-thinning audit is wired as `pnpm client-thinning:audit` and its
  fixture reproducibility is complete (21 rules, 52 tests). The four known
  defeated shallow rules were hardened on 2026-05-30.

Resolved A-items (see [`plan.md`](plan.md) for the full classification):

- **A1** prompt-assembly content parity — closed for current scope. PluginV2
  edit/replacer hooks, interactive Lua dialog APIs, and non-vision image caption
  fallback remain explicit `unsupported`. `useServerPromptAssembly` still
  defaults off, so local assembly remains the default production path.
- **A2** post-generation durable derivation — closed on the server-dispatch path
  by slice 4. Browser derivation remains only on the local-assembly/completion
  path while the prompt-assembly flag is off.
- **A3** provider coverage — closed for current scope; unsupported shapes
  already hard-fail.

Fine in the browser (not blockers): **B1** permanent client-owned effects, and
**B2** orchestration/command-replay that the browser may keep. See
[`status/client-owned-unsupported.md`](status/client-owned-unsupported.md).

Legacy / removed: **group chat** is now fully legacy and must be removed from the
client, not merely unsupported. Event patching stays deferred. Flags:
`useServerGeneration` removed (2026-05-29); `isFastifyServer` and
`useServerPromptAssembly` kept and annotated in-code, not deprecated.

Caveat on the audit: reproducible but not uniformly robust — some rules still use
source-text needles/regex counts. The four empirically defeated rules are now AST
invariants; hardening any remaining shallow rule requires first demonstrating a
sincere defeat against the real binary. See [`status/audit.md`](status/audit.md).

## Active Direction

- Treat A1/A2 implementation as landed, but the workstream as not closed out.
- Start with the audit. If `pnpm client-thinning:audit` is red, fix or triage
  before wider runtime changes; then record in
  [`coverage/latest-verification.md`](coverage/latest-verification.md).
- Next work is group-chat legacy removal and any documentation reconciliation
  after source changes. Additional audit-rule hardening is only opened after a
  demonstrated defeat. Keep event patching deferred until SSE reconnect/replay
  exists.

## Start Here

- [Overview](status/overview.md) — phase language and main entry points.
- [Next steps](status/next-steps.md) — prioritized work order.
- [sendChat / chat-process ownership](status/sendchat-thinning.md) — the detailed
  A/B blocker triage.
- [Server projection](status/server-projection.md) — bootstrap, guard, events
  (event patching deferred).
- [Audit](status/audit.md) — reproducibility done; four defeated rules hardened.
- [Command boundaries](status/command-boundaries.md) — closed/stable.
- [Assets, imports, backups](status/assets-imports-backups.md) — closed/stable.
- [Client-owned / legacy](status/client-owned-unsupported.md) — B1 keep, group
  chat remove.
