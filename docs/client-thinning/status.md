# Client Thinning Status

Date: 2026-05-29

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
- Assembly-time scriptstate persistence (C-A1) is server-owned by
  `/generate/chat`; the browser applies the patch as projection and reconciles
  the returned revision instead of re-POSTing that delta.
- The server Lua VM runtime is landed, but prompt-assembly hooks are not wired.
- Bootstrap projection, command-event invalidation, `.risu` import/export/bundle,
  asset routes, backup/restore, and provider secret masking are closed.
- The client-thinning audit is wired as `pnpm client-thinning:audit` and its
  fixture reproducibility is complete (21 rules, 45 tests).

Active blocker set (see [`plan.md`](plan.md) for the full classification):

- **A1** prompt-assembly content parity — remaining gaps are image-gen view
  instruction and Lua `editRequest`/`editprocess`/input-trigger/`editinput`
  wiring. PluginV2 edit/replacer hooks are permanent unsupported; non-vision
  image caption fallback is explicit unsupported. `useServerPromptAssembly`
  still defaults off, so local assembly remains the default production path.
- **A2** post-generation durable derivation — the **output trigger** (no server
  `'output'` invocation) and **`editoutput`** — needs server script execution.
- **A3** provider coverage — closed for current scope; unsupported shapes
  already hard-fail.

Fine in the browser (not blockers): **B1** permanent client-owned effects, and
**B2** orchestration/command-replay that the browser may keep. See
[`status/client-owned-unsupported.md`](status/client-owned-unsupported.md).

Legacy / removed: **group chat** is now fully legacy and must be removed from the
client, not merely unsupported. Event patching stays deferred. Flags:
`useServerGeneration` removed (2026-05-29); `isFastifyServer` and
`useServerPromptAssembly` kept and annotated in-code, not deprecated.

Caveat on the audit: reproducible but not uniformly robust — roughly a dozen rules are
string/regex matchers and four were empirically defeated by sincere refactors.
Audit-rule hardening is a tracked work item. See [`status/audit.md`](status/audit.md).

## Active Direction

- Treat the workstream as active, not complete.
- Start with the audit. If `pnpm client-thinning:audit` is red, fix or triage
  before wider runtime changes; then record in
  [`coverage/latest-verification.md`](coverage/latest-verification.md).
- Pick one blocker item per batch; name the browser branch, the server contract,
  and the proof. Do not mix A1 content classes, A2, and group-chat removal in one
  review.

## Start Here

- [Overview](status/overview.md) — phase language and main entry points.
- [Next steps](status/next-steps.md) — prioritized work order.
- [sendChat / chat-process ownership](status/sendchat-thinning.md) — the detailed
  A/B blocker triage.
- [Server projection](status/server-projection.md) — bootstrap, guard, events
  (event patching deferred).
- [Audit](status/audit.md) — reproducibility done; rule-hardening open.
- [Command boundaries](status/command-boundaries.md) — closed/stable.
- [Assets, imports, backups](status/assets-imports-backups.md) — closed/stable.
- [Client-owned / legacy](status/client-owned-unsupported.md) — B1 keep, group
  chat remove.
