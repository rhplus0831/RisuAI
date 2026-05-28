# Client Thinning Note

Date: 2026-05-29

Short handoff for the standalone client-thinning workstream. Runtime behavior
was not changed by the latest audit-fixture batch. Start with
[`status.md`](status.md), [`coverage.md`](coverage.md), and only the shard for
the behavior being changed.

## Latest Verification

- Command: `pnpm client-thinning:audit`
- Result: Passed. The audit printed `Client-thinning audit passed.`
- Command: `pnpm exec vitest run util/client-thinning-audit.test.ts`
- Result: Passed. The run reported 1 test file passed and 14 tests passed.

## Checkpoint Scope

- Delta class: audit fixture reproducibility.
- Source material: `docs/archive/fastify/client-thinning/`, archived Phase 9,
  `docs/structure/`, `util/client-thinning-audit.ts`, Fastify routes, client
  server adapters, projection guard, command helpers, provider routing, and
  generation chat route.
- The old Phase 9 closeout is not being reopened wholesale. This folder turns
  the remaining projection-hardening work into an independently selectable
  task family.

## Current State

Implemented:

- Fastify can serve the SPA and inject `globalThis.__FASTIFY__ = true` from
  `server/fastify/src/app.ts:154`.
- Browser startup uses `/api/v1/bootstrap`; writer-intent bootstrap registers
  the active writer and read-only refresh skips that header
  (`src/ts/server/bootstrap.ts:25`, `src/ts/server/bootstrap.ts:31`).
- Durable browser mutations should go through command helpers and
  `/api/v1/commands/*` routes with `baseRevision`, revision bump, and command
  events (`src/ts/server/commands.ts:2152`,
  `server/fastify/src/commands/mutations.ts:28`).
- The active-writer guard rejects stale mutating sessions with 423 and covers
  commands, imports, assets, backups, generation chat, preview prompt, memory
  jobs, and legacy storage writes (`server/fastify/src/activeWriter.ts:20`,
  `server/fastify/src/activeWriter.ts:49`).
- The projection write guard can freeze `DBState.db` in Fastify mode and
  requires trusted projection writes (`src/ts/server/projectionWriteGuard.svelte.ts:12`).
- Command and memory events stream over `/api/v1/events`; command events are
  consumed by the browser event adapter (`server/fastify/src/routes/events.ts:25`,
  `src/ts/server/events.ts:50`).
- Fastify server generation is the provider dispatch gate in Fastify mode.
  Unsupported provider shapes fail explicitly instead of falling through to a
  browser provider request (`src/ts/process/request/serverCompletion.ts:538`).

Bounded or partial:

- Prompt assembly is not fully thin by default. `sendChat` uses the server
  `/chat` assembly path only when Fastify mode is active and
  `DBState.db.useServerPromptAssembly` is true
  (`src/ts/process/index.svelte.ts:157`), and the setting defaults to false
  (`src/ts/storage/database.svelte.ts:776`).
- Audit fixture reproducibility is the first standalone open item. Every A4R
  rule (`A4R1`–`A4R7` plus the `A4R-` named rules), `EC6 asset walker validator
  drift`, and `EC5 active-writer guard` now have committed pre-fix fixtures and
  tests proving non-zero exit. The remaining open rules are the EC/AEC
  structural invariants (`EC1`, `EC2`, `EC4`, `AEC2`, `AEC4`, `AEC5`, `AEC6`),
  which still need committed fixtures.
- `util/client-thinning-audit.ts` is broad and structural, but currently lives
  as one monolithic script. Treat new findings as audit-rule work plus
  reproducibility proof, not as one-off call-site fixes.
- Manual legacy local client verification was deferred in the archive. It is a
  separate compatibility task, not a reason to weaken Fastify projection rules.

Client-owned, no-port, or deferred:

- The browser owns rendering, UI selection, local interaction state, plugin
  runtime execution, browser-only media APIs, and event-to-projection refresh.
- Plugin code execution remains browser-side. Server commands own plugin
  records and plugin storage, not plugin runtime behavior.
- Per-event surgical projection patches are future optimization. Current
  command events schedule projection refreshes.
- Browser local persistence as a primary runtime, native/mobile wrappers,
  service workers, peer sync, Drive sync, Risu Account Sync, group chat, and
  removed memory engines are no-port unless a new plan explicitly reopens them.

## Next Client-Thinning Delta Target

1. Run `pnpm client-thinning:audit`. If it is red, fix or explicitly triage the
   failing audit before selecting wider runtime work.
2. Continue audit fixture reproducibility unless source inventory proves a more
   urgent live bug. All A4R rules, `EC6`, and `EC5` are covered; the next
   fixture target is `EC4 stable command ids`, then the remaining EC/AEC
   structural rules (`EC1`, `EC2`, `AEC2`, `AEC4`, `AEC5`, `AEC6`).
3. If adding a new finding, update the invariant, audit rule, fixture, test, and
   the smallest relevant status/coverage shard in the same batch.
4. Treat `sendChat` client-thinning as a separate sub-family. A valid batch must
   name one browser-owned branch, the server contract that replaces it, and the
   proof that local fallback is no longer needed.
5. Avoid broad cleanup batches. Pick one invariant family: audit
   reproducibility, command boundary, projection refresh/write guard,
   asset/import/backup boundary, provider/prompt routing, memory mutation, or
   client-owned no-port hardening.

## Automation Batching Policy

- Choose one coherent batch before editing.
- Write a compact scope: invariant, owner, timing, input context, allowed
  mutations, persistence shape, errors, rollback, active-writer behavior,
  projection refresh behavior, and proof command.
- Runtime changes should update docs after the code and proof are complete.
- Commit messages should use the repository convention (`feat:`, `fix:`,
  `refactor:`) unless the caller asks for a different style.
