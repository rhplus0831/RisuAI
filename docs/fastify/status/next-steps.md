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

9-5d-i then routed remaining settings-style residual writes through the
existing settings command bridge:

- Manual settings pages now watch residual provider/runtime/display/media/
  advanced keys such as `NAIsettings`, `ainconfig`, `localStopStrings`,
  `modelTools`, `customModels`, `banCharacterset`, `colorScheme`, and
  `showUnrecommended`.
- Dedicated resource command bridges stayed authoritative for prompt
  templates/items, personas, translator presets, plugins, modules, and
  import/storage paths.
- Focused regression coverage landed in `src/ts/server/commands.test.ts`.

## Immediate Pickup

9-5d was too broad as a single implementation slice. Keep the parent
goal, but implement it through the smaller 9-5d sub-slices below. Do not
start 9-5e yet; the read-only guard still needs these residual write
replacements first.

Current code audit found the remaining direct-write clusters are not
uniform:

- Settings-style scalar writes under `src/lib/Setting/Pages/`,
  `src/ts/setting/utils.ts`, `src/ts/gui/colorscheme.ts`,
  `src/lib/Others/WelcomeRisu.svelte`, and small provider/runtime/media
  helper paths.
- 9-2 low-churn resource tails around prompt templates, personas,
  translator presets, and loadouts.
- 9-3 character/chat UI tails, especially character profile/assets,
  chat folders, selected chat/page state, playground/realm/grid helpers,
  and import helpers that already have partial command dispatch.
- 9-4 extension tails around lorebooks, module UI/MCP helpers, plugin
  settings, plugin database translation, and plugin storage.
- Process/runtime writes in generation, scriptstate, memory, and MCP
  helpers that need classification before the read-only guard can be
  enabled.

Immediate pickup: **9-5d-ii - 9-2 resource UI tails**.

- Audit residual prompt template/item, persona, translator preset, and
  loadout UI/helper writes that still mutate `DBState.db` directly in
  server-backed web mode.
- Use the existing 9-2 command helpers and rollback bridges; do not add
  new endpoints unless the command map is genuinely missing a resource
  operation.
- Keep settings scalar keys on the settings bridge from 9-5d-i. If a
  field belongs to prompt/persona/translator/loadout resource state, use
  the dedicated resource command bridge instead.
- Keep Tauri/local-only import/export, setup, backup, storage, and asset
  byte paths untouched unless the helper already has explicit
  server-backed behavior.
- Add focused tests around the highest-risk changed resource bridge,
  usually in `src/ts/server/commands.test.ts` or the nearest UI/helper
  test that can assert command dispatch and rollback.

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
- Several direct-write search hits are expected rollback helpers or
  optimistic local updates followed by command dispatch. Each 9-5d
  sub-slice should prove the server-backed behavior, not mechanically
  delete every local assignment.

## Later Queue

1. 9-5d-ii - 9-2 resource UI tails: prompt templates, personas,
   translator presets, and loadouts.
2. 9-5d-iii - 9-3 character/chat UI tails: character profile/assets,
   chat folders, selected chat/page state, playground/realm/grid helpers,
   and legacy import helpers.
3. 9-5d-iv - 9-4 extension UI/API tails: lorebooks, module UI/MCP
   helpers, plugin settings, plugin database translation, and plugin
   storage.
4. 9-5d-v - Process/runtime durable-write classification: generation,
   scriptstate, memory, and MCP helper writes that must become commands,
   explicit unsupported behavior, or documented local/runtime-only state.
5. 9-5e-i - Projection write gate foundation.
6. 9-5e-ii - Command bridge guard integration.
7. 9-5e-iii - Guard audit closeout.
8. 9-6a - Server-backed persistence gate.
9. 9-6b - Asset byte gate.
10. 9-6c - Server backup/restore projection.
11. 9-6d - Residual local cache classification.
12. 9-6e - Provider secret masking.
13. 9-7a - `.risu` fixture corpus and codec harness.
14. 9-7b - Legacy envelope codec port.
15. 9-7c - RISUSAVE block codec port.
16. 9-7d - Decode normalization and validation.
17. 9-7e - Repository-backed export adapter.
18. 9-8a - Multipart `.risu` import route.
19. 9-8b - Repository `.risu` export route.
20. 9-8c - Asset reference walker.
21. 9-8d - Bundle export route.
22. 9-9a - Server-backed browser smoke harness.
23. 9-9b - Generation and memory fixture closeout.
24. 9-9c - Server-backed storage-write audit.
25. 9-9d - Manual Fastify web and Tauri local verification.
26. 9-9e - Phase 9 docs closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused residual-sweep tests while building each 9-5d sub-slice. Run
the full matrix before closing the parent 9-5d sweep:

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
- 9-5d-i: `pnpm exec vitest run src/ts/server/commands.test.ts`; `pnpm check`
  - 35 tests passed; check clean.
- 9-5d sub-slices: run the nearest focused command/bridge tests touched
  by the sub-slice, then `pnpm check` before marking that sub-slice done.

## References

- Active phase:
  [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md)
- Command map:
  [`phase-9-command-map.md`](phase-9-command-map.md)
- Closed memory phase:
  [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-9-client-thinning-9-5d-i.md`](../phases-completed/phase-9-client-thinning-9-5d-i.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
