# Client Thinning Status

Date: 2026-05-28

This is the status router for the standalone client-thinning workstream. The
codebase is the source of truth; detailed inventories belong in the shards.

## Current Snapshot

Implemented:

- Fastify-served web mode is the supported web runtime. Fastify injects the
  browser marker when serving the SPA.
- The browser loads a bootstrap projection, caches the command revision, and
  receives command/memory events.
- Durable resource mutation is command-backed for the major resource families.
  Commands use `baseRevision`, return conflicts, bump revision once on success,
  and emit command events.
- The active-writer guard protects server-owned mutation routes.
- Projection writes are guarded in Fastify mode outside trusted projection
  write scopes.
- Provider dispatch is server-routed in Fastify mode for supported provider
  shapes; unsupported provider shapes fail explicitly.
- The client-thinning audit exists and is wired as `pnpm client-thinning:audit`.

Bounded or partial:

- Audit fixture reproducibility is open. Each audit rule needs a committed
  pre-fix fixture and test proof in this active task.
- `sendChat` prompt assembly is server-capable but not default-thin. The
  browser still falls back to local prompt assembly unless
  `useServerPromptAssembly` is enabled.
- Post-generation orchestration remains mixed between server and browser.
- Event handling uses debounced bootstrap refresh rather than per-resource
  event patching.
- Manual legacy local client verification is outside the Fastify projection
  closeout and remains separate.

Client-owned, unsupported, or no-port:

- The browser owns rendering, route/navigation state, local UI interaction,
  browser media APIs, plugin runtime execution, and browser-only effects.
- Plugin storage is server-backed, but plugin code execution remains
  browser-side.
- Historical local persistence runtimes, native/mobile wrappers, service
  worker behavior, group chat, peer sync, Drive sync, and removed memory
  engines are not client-thinning targets.

## Active Direction

- Treat the workstream as active, not complete.
- Start with the audit. If `pnpm client-thinning:audit` is red, fix or triage
  that before selecting wider runtime changes.
- The best first code batch is audit fixture reproducibility: fixture/test proof
  for the structural audit rules.
- Runtime expansion or deletion must name one invariant family and one proof
  command before editing.

## Start Here

- [Status overview](status/overview.md) - current phase language and main code
  entry points.
- [Next steps](status/next-steps.md) - priority, non-goals, and closed areas.
- [Server projection](status/server-projection.md) - bootstrap, guard, events,
  and storage ownership.
- [Audit](status/audit.md) - audit rules and reproducibility target.
- [Command boundaries](status/command-boundaries.md) - command contract and
  active-writer behavior.
- [Assets, imports, backups](status/assets-imports-backups.md) - durable
  boundary fidelity.
- [sendChat thinning](status/sendchat-thinning.md) - prompt assembly,
  generation persistence, and post-generation browser branches.
- [Client-owned unsupported](status/client-owned-unsupported.md) - no-port and
  browser-owned behavior.

## Maintenance Rules

- Keep one canonical home for each detailed claim; root docs summarize and
  link only.
- Update `coverage/latest-verification.md` only after running a verification.
- When a new finding appears, update the invariant, audit, fixture/test, and
  relevant status/coverage shard together.
