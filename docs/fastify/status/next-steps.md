# Next Steps

Date: 2026-05-26

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-5b and 9-5c moved Fastify-served web startup onto
`GET /api/v1/bootstrap` and subscribed it to `GET /api/v1/events`.

Two 9-5d residual sweep passes then landed:

- Character asset helpers and legacy v1 chat JSON imports now dispatch
  existing character/chat commands in Fastify mode.
- Drag, manual, service-worker, and browser file-handler `.risum` module
  import paths now return explicit unsupported behavior in server-backed
  web mode before local asset writes.
- Lorebook local activation now dispatches the existing chat lorebook
  replacement command after the optimistic `chat.localLore` change.
- Focused regressions landed in `src/ts/compatibilityAdapters.test.ts`
  and `src/ts/process/modules.test.ts`.

## Immediate Pickup

Continue **9-5d - Residual command replacement sweep**. Do not start
9-5e yet; the read-only guard still needs more residual write
replacement.

- Sweep remaining direct `DBState.db` writes and mutable `getDatabase()`
  references in server-backed web paths for resource families already
  owned by 9-2 through 9-4.
- Replace remaining server-backed web writes with existing typed command
  helpers, compatibility bridges, or explicit unsupported behavior where
  a later slice has not defined a server path.
- Keep Tauri/local-only import, storage, backup, and file paths untouched.
- Treat bootstrap projection replacement and event-driven re-bootstrap as
  projection boundaries, not ordinary UI mutation exceptions.
- Add focused regression tests around the highest-risk write sites found.

Out of scope for 9-5d: the read-only `DBState.db` guard, storage and
provider-key gating, server-side `.risu` import/export, asset byte
storage changes beyond existing Fastify asset APIs, server-side plugin
execution, and per-event surgical browser projection patching.

Implementation notes:

- Command code lives in `server/fastify/src/commands/`,
  `server/fastify/src/routes/commands.ts`, and
  `src/ts/server/commands.ts`. The command map is the source of truth for
  names, payload behavior, events, and plugin bridge policy.
- Browser projection now loads through `src/ts/server/bootstrap.ts` and
  refreshes from `src/ts/server/events.ts`; debounced re-bootstrap is the
  Phase 9 target, while per-event patches are future work.
- Tauri keeps its local storage path. All 9-5d gates should be
  server-backed web specific.
- Character scalar patches reject child collections, while 9-4d owns
  character asset-reference fields and Fastify-mode `saveAsset` returns
  raw server asset ids.
- Chat metadata patches reject `message`, `localLore`, `scriptstate`,
  generation/runtime fields, and child collections except the 9-4c
  `modules` field. Use message, generation, scriptstate, lorebook, or
  module commands for those fields.
- Message commands reject `generationInfo`; durable generation metadata
  belongs on the 9-3d generation persistence command. Message rows keep
  `message.chatId` as the public message id after 9-3c normalization.
- 9-4a/9-4b whole-collection bridges cover bound lorebook and
  script/trigger UI surfaces. 9-4c covers module records and
  active-module toggles. 9-4e/9-4f cover plugin records, provider
  selection, plugin storage, and unknown plugin DB keys.
- 9-4g tightened plugin database translation for
  `currentPluginProvider`, `modules`, and `enabledModules` without adding
  new endpoints.
- MCP module import, MCP asset import, and server-backed `.risum` module
  import remain explicitly unsupported until later slices define
  dedicated server-owned paths.

## Later Queue

1. 9-5d - Residual command replacement sweep.
2. 9-5e - Read-only `DBState.db` guard.
3. 9-6 - Storage and provider-key gating.
4. 9-7 - Server `.risu` codec core.
5. 9-8 - Import/export routes and bundle assets.
6. 9-9 - Full server-backed fixture sweep and closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused residual-sweep tests while building 9-5d, then before
closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after the 9-5d first pass:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 709 tests passed, 4 skipped.
- `pnpm api:test` - 1119 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

Focused 9-5 runs:

- 9-5a: `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/events.test.ts`
  - 4 tests passed.
- 9-5b: `pnpm exec vitest run src/ts/server/bootstrap.test.ts src/ts/bootstrap.test.ts`
  - 5 tests passed.
- 9-5c: `pnpm exec vitest run src/ts/server/events.test.ts src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts`
  - 11 tests passed.
- 9-5d first pass: `pnpm exec vitest run src/ts/compatibilityAdapters.test.ts`; `pnpm check`
  - 8 tests passed; check clean.
- 9-5d second pass: `pnpm exec vitest run src/ts/compatibilityAdapters.test.ts src/ts/process/modules.test.ts`; `pnpm check`
  - 9 tests passed; check clean.

## References

- Active phase:
  [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md)
- Command map:
  [`phase-9-command-map.md`](phase-9-command-map.md)
- Closed memory phase:
  [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-9-client-thinning-9-5c.md`](../phases-completed/phase-9-client-thinning-9-5c.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
