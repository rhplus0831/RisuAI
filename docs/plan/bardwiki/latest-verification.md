# BardWiki Latest Verification

Date: 2026-08-29

Verdict: complete. Every required behavior area has passing automated proof,
the critical visible workflow has browser proof, and no correctness blocker or
accepted residual gap remains. The current shipped architecture is documented
in [`docs/structure/bardwiki.md`](../../../docs/structure/bardwiki.md).

## Aggregate Proof

```text
pnpm test:affected --base origin/fastify --include-smoke
# Expanded to pnpm test:all because build/dependency/CI surfaces changed.
# PASS in 4m 49.7s:
# - protocol, client-library, Fastify, and browser-smoke typechecks
# - 536 frontend files, 6,619 tests
# - 169 server files, 3,513 passed, 1 direct-only scale case skipped
# - isolated Realm scale gate: 1 passed, 29 non-selected cases skipped
# - UI coverage gate: 6 files, 206 tests; thresholds passed
# - browser smoke: 38 passed
# - frontend performance gates: 2 files, 6 tests
# - Svelte diagnostics: 0 errors, 0 warnings
# - repository-wide Prettier check

pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
# Both passed with no diagnostics.
```

The direct-only Realm case skipped by the ordinary server lane is the same
7,000-display-asset case selected by the isolated scale command, where it
passed. The aggregate browser run includes
`server/fastify/browser-smoke/bardWikiLifecycle.spec.ts`.

## Focused BardWiki Proof

```text
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/bardWiki*.test.ts
# 14 files, 100 tests passed

pnpm exec vitest run \
  packages/protocol/src/bardWiki.test.ts \
  packages/protocol/src/importBoundary.test.ts \
  src/lib/ChatScreens/BardWikiWorkspace.lazy.test.ts \
  src/lib/ChatScreens/BardWikiWorkspace.svelte.test.ts \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts \
  src/lib/Setting/Pages/BardWikiSettings.svelte.test.ts \
  src/lib/Setting/Pages/OtherBotSettings.svelte.test.ts \
  src/ts/process/request/tests/serverBardWikiJobs.test.ts \
  src/ts/server/bardWikiCommands.test.ts \
  src/ts/server/commands.test.ts \
  src/ts/server/events.test.ts \
  src/ts/server/memoryJobProjection.test.ts \
  src/ts/server/pendingMutationOutbox.test.ts \
  src/ts/server/resourceInvalidation.test.ts
# 14 files, 658 tests passed
```

The full aggregate server lane additionally owns commands, backup policy,
route protection, generation chat/operations, prompt assembly/templates,
Hypa repository/worker/events/jobs, request history, database defaults and
migrations, message storage, and lifecycle integrations. The full frontend
lane additionally owns language-pack parity and every surrounding settings,
chat, resource, and durable-mutation regression.

## Required Behavior Matrix

| Area | Passing proof |
| --- | --- |
| Manual documents | `bardWikiRepository.test.ts` and `bardWikiRoutes.test.ts` cover CRUD, immutable versions, stale revision/version/hash rejection, rollback, reloadable reads, body-free indexes, cross-chat isolation, ETags, command events, and mutation replay. Workspace and client command tests cover retained drafts plus accepted/queued/failed outcomes. |
| Confirmation | `bardWikiConfirmation.test.ts`, `generation.chat.test.ts`, and `bardWikiApplyTurnHandler.test.ts` prove explicit current-tail confirmation, automatic preceding-turn scheduling after accepted sends, exact ids/hashes, deduplication, and exclusion of first-send/current-send, continue, regenerate, failed/cancelled, alternate, comment, and disabled boundaries. Workspace tests and browser smoke prove the visible action/status. |
| Jobs | `bardWikiJobs.test.ts`, `bardWikiWorker.test.ts`, `bardWikiJobRoutes.test.ts`, and `events.test.ts` cover isolated/fair lanes, retry/backoff, cancel/abort isolation, restart recovery, committed-before-complete replay, retention, progress, sanitized payload/status, reconnect snapshots, and Hypa non-starvation. |
| Model writes | `bardWikiCanonicalModel.test.ts`, `bardWikiContract.test.ts`, and `bardWikiApplyTurnHandler.test.ts` cover strict event/canonical schemas, one bounded repair, one fresh-snapshot conflict recompile, source/settings rereads, version/hash fences, and atomic document/version/link/search/provenance/manifest/receipt/revision/event publication. |
| Source mutation | `bardWikiConfirmation.test.ts`, `bardWikiLifecycle.test.ts`, `bardWikiRebuildHandler.test.ts`, and generation/message command coverage prove pending obsolescence, safe inverse, `needs_review` fallback, truncate/delete/alternate handling, rebuild restart/resume, and invisible staging before atomic publication. |
| Prompt | `bardWikiSelection.test.ts`, `bardWikiPrompt.test.ts`, `memory.test.ts`, `templates.test.ts`, `assemble.test.ts`, and `generation.chat.test.ts` cover deterministic title/alias/body/heading ranking, link expansion/deduplication, degraded search, pinned overflow, whole-row budgeting, disabled/Hypa/BardWiki/Hybrid modes, final trimming, and preview/prompt-SSE/provider parity without provider work or writes. |
| UI | Settings/workspace/lazy/component tests cover global and nullable per-chat settings, responsive/focus behavior, manual editing, confirmation, queued/failed/conflict/review states, job controls, rebuild, and vault flows. The BardWiki lifecycle browser scenario proves settings, provider-cost help, workspace, manual creation, confirmation status, lifecycle warnings, and reload persistence end to end. |
| Lifecycle | `bardWikiLifecycle.test.ts`, `bardWikiVault.test.ts`, `bardWikiRebuildHandler.test.ts`, `backups.test.ts`, `commands.test.ts`, and route tests cover physical delete cascades, no-copy forks, bounded deterministic export, hostile ZIP rejection, dry-run/apply fences and rollback, exact authoritative restore, derived-index repair, and full/missing-only rebuild semantics. |
| Security/privacy | `bardWikiRoutes.test.ts`, `routeProtection.test.ts`, `bardWikiContract.test.ts`, `bardWikiVault.test.ts`, `requestHistory.test.ts`, and event/job tests cover auth, active-writer and revision fences, route/body/job/model/import bounds, path safety, no source text in confirmation candidates, no raw documents/provider output in routine events/status/metrics, and existing secret masking/deadlines. |
| Performance | The prompt selector and workspace resource benchmarks below use the Phase 0 maximum 2,000-document corpus. Worker tests prove BardWiki cannot occupy the Hypa lane; generation/prompt tests prove retrieval never waits for a job. Document bodies and versions remain lazy. |

## Measured Observations

```text
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/bardWikiSelection.test.ts --reporter=verbose
# 1 file, 7 tests passed
# documents=2000 candidates=512 selected=32 elapsedMs=7.76

pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/bardWikiRoutes.test.ts --reporter=verbose
# 1 file, 10 tests passed
# body-free workspace index: documents=2000 elapsedMs=7.93
```

These are local Node/SQLite/Fastify-injection observations on the verification
machine, deliberately diagnostic rather than enforced wall-clock thresholds.
The selector has deterministic 512-candidate and 32-selected-document bounds;
the workspace index omits Markdown bodies and loads bodies/version pages only
on demand. The production smoke build reported the lazy BardWiki settings chunk
at 6.17 kB minified / 1.92 kB gzip and the workspace chunk at 41.88 kB minified
/ 11.77 kB gzip.

## Documentation And Audit

Current ownership is discoverable from `STRUCTURE.md` and the structure index.
The BardWiki guide and the backend, data/events, durable-mutation, resource,
prompt, assets/saves, testing, settings, chat, and generation guides describe
the shipped behavior. English owns the complete string contract and Korean
contains matching BardWiki strings. A local target check resolved every local
Markdown link in the 25 current guides, and `git diff --check` passed.

The closeout audit used direct implementation/test inspection and the successful
Phase 6 parallel architecture cross-check. Three additional Phase 7 read-only
parallel workers timed out and produced no evidence; none of the conclusions in
this record depend on them.

## Caveats And Residuals

- Browser smoke uses deterministic local provider fixtures. It does not spend
  against a real provider account or claim interoperability with every external
  Obsidian plugin.
- Existing build warnings remain for `::highlight`, browser-externalized Node
  modules, plugin timing, and large chunks; the build and warning-policy tests
  pass, and no warning is BardWiki-specific.
- Semantic embeddings, collaborative/multi-writer merge, and live vault sync
  remain explicit non-goals, not incomplete work.
- There are no accepted residual correctness gaps and no temporary BardWiki
  rollout bypasses or debug logs.

Phase 7 closes the workstream. The intact plan is archived under
`.archived-docs/memory-and-context/bardwiki/`.
