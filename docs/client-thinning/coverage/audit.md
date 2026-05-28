# Audit Coverage

Date: 2026-05-29

## Current Proof

- `pnpm client-thinning:audit` runs `tsx util/client-thinning-audit.ts`.
- The audit derives many checks from source structure and call graphs rather
  than literal old bug strings.
- Archived rule work moved the audit toward invariants; the active task now
  needs reproducible fixtures/tests.
- Rule inventory is reconciled with `util/client-thinning-audit.ts` as of
  2026-05-29.
- `util/client-thinning-audit.test.ts` provides the reusable fixture harness.
  It runs the audit script with a fixture root as `cwd` and
  `CLIENT_THINNING_AUDIT_CHECK_IDS` selecting one rule.
- `A4R-saveasset filename classification` has committed failing and bypass
  fixtures under
  `util/client-thinning-audit-fixtures/saveasset-filename-classification/`.
- `A4R-backup data dir inventory` has a committed failing fixture under
  `util/client-thinning-audit-fixtures/backup-data-dir-inventory/`.
- `A4R-bounded process-lifetime accumulators` has committed failing and bypass
  fixtures under
  `util/client-thinning-audit-fixtures/bounded-process-lifetime-accumulators/`.
- `A4R7 asset URL gate` has committed failing and bypass fixtures under
  `util/client-thinning-audit-fixtures/asset-url-gate/`.
- `A4R-fanout composite command race` has committed failing and bypass fixtures
  under `util/client-thinning-audit-fixtures/composite-command-fanout/`.
- `A4R4 globally-addressed resolver normalize` has committed failing and
  normalize-first bypass fixtures under
  `util/client-thinning-audit-fixtures/resolver-normalize/`. The failing fixture
  proves both resolver pairs (`requireChatLocation`/`normalizeAllCharacterChats`
  and `requireMessageLocation`/`normalizeAllChatMessages`) exit non-zero when the
  resolver runs without the matching normalizer earlier in the same scope.
- `A4R5 asset reference parser parity` has committed failing and parity-bypass
  fixtures under `util/client-thinning-audit-fixtures/asset-reference-parser-parity/`.
  The failing fixture drifts the walker `addReference` regex from the client
  `LOCAL_ASSET_PATH_RE`; the bypass keeps both regex literals identical.
- `A4R6 wildcard secret row identity` has committed failing and classified-bypass
  fixtures under `util/client-thinning-audit-fixtures/wildcard-secret-row-identity/`.
  The failing fixture declares a wildcard object-array secret (`customModels`)
  with no entry in `ARRAY_ROW_IDENTITY_KEYS`; the bypass classifies every
  wildcard array secret with a stable row identity key.
- `A4R3 transitive command-path id minting` has committed failing and
  validated-id-bypass fixtures under
  `util/client-thinning-audit-fixtures/transitive-command-id-minting/`. The
  failing fixture proves both the direct route-handler mint and the transitive
  helper mint exit non-zero; the bypass takes the id from a validated request
  param and calls a normalize-on-read helper with a persisted-state binding.
- `A4R2 conflict replay outside central wrapper` has committed failing and
  surface-conflict-bypass fixtures under
  `util/client-thinning-audit-fixtures/conflict-replay/`. The failing fixture
  replays a mutating command after a conflict in a non-wrapper helper; the
  bypass surfaces the conflict and proves the `runServerCommand`/`commands.ts`
  exemption is load-bearing (the same body fails when not at the exempt path).
- `A4R1 passive refresh writer ownership` has committed fixtures under
  `util/client-thinning-audit-fixtures/passive-refresh-writer-ownership/`:
  `failing-passive-caller` (a non-allowlisted file calls the writer-intent
  bootstrap helper), `failing-readonly-header` (a read-only helper attaches
  `activeWriterSessionHeader(`), and `writer-intent-bypass` (the writer helper
  is only called from the allowlisted page-load entrypoint). This completes the
  A4R rule family.
- `EC6 asset walker validator drift` has committed `failing-missing-owner` and
  `owned-bypass` fixtures under
  `util/client-thinning-audit-fixtures/asset-walker-validator-drift/`. The
  bypass reproduces the real walker's collected fields and carries every owner
  validator needle; the failing fixture adds an unowned walker field
  (`database.legacyAvatar`).
- `EC5 active-writer guard` has committed `failing-unclassified-route` and
  `classified-bypass` fixtures under
  `util/client-thinning-audit-fixtures/active-writer-guard/`. The bypass mirrors
  the full mutating-route surface (every `MUTATING_ROUTE_RULES` entry matches a
  route), carries the active-writer classifier needles and the server
  chat/memory helper needles, and wires `registerActiveWriterGuard` after
  bootstrap and before the mutation registrars; the failing fixture adds an
  unclassified `POST /api/v1/widgets` route.
- `EC4 stable command ids` has committed `failing-minting-constructor` and
  `no-mint-bypass` fixtures under
  `util/client-thinning-audit-fixtures/stable-command-ids/`. The bypass supplies
  all command-path constructors as validate-only and keeps `promptTemplate` out
  of the settings maps; the failing fixture makes `createCharacterRecord` mint
  `randomUUID()`.
- `EC2 plugin storage gates` has committed `failing-ungated-getitem` and
  `gated-bypass` fixtures under
  `util/client-thinning-audit-fixtures/plugin-storage-gates/`. The bypass gates
  every storage method, `SafeIdbFactory` member, and the V3 bridge needles, and
  keeps `pluginV2` out of `allowedDbKeys`; the failing fixture drops the gate
  assert from `SafeLocalStorage.getItem`.
- `EC1 provider ownership` has committed `failing-useservergeneration-setting`
  and `server-routed-bypass` fixtures under
  `util/client-thinning-audit-fixtures/provider-ownership/`. The bypass keeps the
  serverCompletion Fastify-mode guards, gates browser Vertex projection writes
  behind `isFastifyServer`, and omits `useServerGeneration` from the settings
  map; the failing fixture exposes `useServerGeneration` as a settings command.

## Open Proof

Each remaining rule needs:

- a committed pre-fix fixture
- a test that runs the rule against the fixture
- an assertion that the rule exits non-zero
- a bypass-shape case when a narrow rule could otherwise pass

## Fixture Harness

Implemented:

- `util/client-thinning-audit.test.ts` spawns
  `node_modules/.bin/tsx util/client-thinning-audit.ts`.
- Fixture source roots live under
  `util/client-thinning-audit-fixtures/<rule-slug>/`.
- Each fixture root contains the minimal `tsconfig.json` and source paths
  needed by the selected audit rule.
- Failing fixtures assert non-zero exit and the intended check id in stderr.
- Bypass fixtures assert zero exit for accepted shapes where the rule has a
  narrow allowed exception.
- Preserve the live repository entry point: `pnpm client-thinning:audit`.

## Rule Inventory

The current audit has 20 check ids. Proposed fixture targets are names, not
existing files yet.

| Check id | Proposed fixture target | Failing shape to fixture | Expected assertion |
| --- | --- | --- | --- |
| `EC5 active-writer guard` | `active-writer-guard` | Move or omit `registerActiveWriterGuard`, add an unclassified mutating Fastify route, drop active-writer classifier needles, or remove client stale-writer handling from server chat/memory helpers. | Covered: failing fixture (unclassified `POST /api/v1/widgets`) exits non-zero with `EC5 active-writer guard`; fully classified route surface with the guard wired in order exits zero. |
| `EC4 stable command ids` | `stable-command-ids` | Let command-path constructors mint `randomUUID()`, expose `promptTemplate` through generic settings commands, or allow command routes to mint durable ids from request payloads. | Covered: failing fixture (`createCharacterRecord` mints `randomUUID()`) exits non-zero with `EC4 stable command ids`; validate-only bypass exits zero. |
| `EC2 plugin storage gates` | `plugin-storage-gates` | Touch localStorage, plugin storage, or IndexedDB bridge methods without `assertDeviceLocalPluginStorageEnabled()`, expose `pluginV2`, or remove Fastify server/local save-mode separation. | Covered: failing fixture (`SafeLocalStorage.getItem` skips the gate) exits non-zero with `EC2 plugin storage gates`; fully gated bypass exits zero. |
| `EC6 asset walker validator drift` | `asset-walker-validator-drift` | Add an asset walker field without validator ownership, leave stale ownership for a removed walker field, or drop a required validator needle. | Covered: failing fixture (unowned walker field) exits non-zero with `EC6 asset walker validator drift`; owned bypass (collected fields equal the owner table, all validator needles present) exits zero. |
| `AEC2 import/export current shape` | `import-export-current-shape` | Remove a block-export resource family, stop import normalization for a block-exported family, desync reserved root keys, or allow root component import to overwrite resource blocks. | Non-zero exit with `AEC2 import/export current shape`. |
| `AEC4 chat folder identity scope` | `chat-folder-identity-scope` | Normalize chat folder ids only per character, fail to update chat `folderId` references after repair, or omit global duplicate-id rejection on create surfaces. | Non-zero exit with `AEC4 chat folder identity scope`. |
| `AEC5 module reference semantics` | `module-reference-semantics` | Treat MCP modules as normal link targets, tolerate unresolved normal module ids, or skip module-link validation on chat create/patch/fork writes. | Non-zero exit with `AEC5 module reference semantics`. |
| `AEC6 asset persistence semantics` | `asset-persistence-semantics` | Stop healing missing asset blobs for existing metadata, reject documented clear values, or omit optional audio asset reference validation from character commands. | Non-zero exit with `AEC6 asset persistence semantics`. |
| `EC1 provider ownership` | `provider-ownership` | Reintroduce browser provider fallback in Fastify mode, allow Fastify preview bodies without explicit support, permit browser Vertex projection writes in Fastify mode, or expose `useServerGeneration` as a server setting command. | Covered: failing fixture (exposes `useServerGeneration` as a settings command) exits non-zero with `EC1 provider ownership`; server-routed bypass exits zero. |
| `A4R1 passive refresh writer ownership` | `passive-refresh-writer-ownership` | Make a read-only bootstrap helper attach `activeWriterSessionHeader()` or call the writer-registering bootstrap helper from a passive refresh path outside `WRITER_BOOTSTRAP_CALLERS`. | Covered: `failing-passive-caller` and `failing-readonly-header` exit non-zero with `A4R1 passive refresh writer ownership`; `writer-intent-bypass` (writer helper called only from the allowlisted entrypoint) exits zero. |
| `A4R2 conflict replay outside central wrapper` | `conflict-replay` | Branch on `result.status === 'conflict'` outside `runServerCommand` and then resend a mutating command with `baseRevision` through a command helper or fetch. | Covered: failing fixture (non-wrapper helper replays after a conflict) exits non-zero with `A4R2 conflict replay outside central wrapper`; surface-conflict bypass (plus the exempt central wrapper) exits zero. |
| `A4R3 transitive command-path id minting` | `transitive-command-id-minting` | Mint ids directly in a `/api/v1/commands/*` route, call a `repair*` id-minting helper from a command route, pass request-derived data to `ensure*`/`normalize*`, or call an unclassified transitive minter. | Covered: failing fixture (direct route-handler mint + transitive helper mint) exits non-zero with `A4R3 transitive command-path id minting`; validated-param + normalize-on-read bypass exits zero. |
| `A4R4 globally-addressed resolver normalize` | `resolver-normalize` | Call `requireChatLocation()` or `requireMessageLocation()` before the matching global normalizer in the same handler/helper scope. | Covered: failing fixture exits non-zero with `A4R4 globally-addressed resolver normalize` for both resolver pairs; normalize-first bypass exits zero. |
| `A4R5 asset reference parser parity` | `asset-reference-parser-parity` | Change the client `LOCAL_ASSET_PATH_RE` without the server walker accepting the same regex shape, or remove the walker `addReference` parity surface. | Covered: failing fixture (walker regex drifted from client) exits non-zero with `A4R5 asset reference parser parity`; identical-regex bypass exits zero. |
| `A4R6 wildcard secret row identity` | `wildcard-secret-row-identity` | Add a wildcard object-array secret path without `ARRAY_ROW_IDENTITY_KEYS`, add an unclassified flat string-array secret, or let wildcard placeholder resolution skip the rejected-row sentinel. | Covered: failing fixture (object-array secret missing a row identity key) exits non-zero with `A4R6 wildcard secret row identity`; fully-classified bypass exits zero. |
| `A4R7 asset URL gate` | `asset-url-gate` | Let Fastify asset-byte helpers fetch arbitrary `loc` values with `risu-auth`, fall back to `?? loc` for unknown shapes, or omit the explicit empty/null/throw default for unknown asset shapes. | Covered: authenticated arbitrary-`loc` fetch and Fastify `?? loc` fallback fixtures exit non-zero with `A4R7 asset URL gate`; documented-shapes bypass exits zero. |
| `A4R-fanout composite command race` | `composite-command-fanout` | Dispatch two or more mutating command helpers in one scope without awaiting each previous call or routing through `runChatCommandSequence`/`runOptimisticCommandSequence`. | Covered: failing fixture exits non-zero with `A4R-fanout composite command race`; bypass fixture (sequencer-routed and awaited-chain shapes) exits zero. |
| `A4R-backup data dir inventory` | `backup-data-dir-inventory` | Add a child to `KNOWN_DATA_DIR_CHILDREN` without referencing it in both `createBackup` and `restoreBackup`, or remove the inventory declaration. | Covered: failing fixture exits non-zero with `A4R-backup data dir inventory` and the missing create/restore references. |
| `A4R-bounded process-lifetime accumulators` | `bounded-process-lifetime-accumulators` | Declare an exported top-level `Set`, `Map`, or `Array` under `server/fastify/src/` without bounded classification, or remove visible eviction from a declared accumulator. | Covered: failing fixture exits non-zero with `A4R-bounded process-lifetime accumulators`; bypass fixture with `// audit:bounded(...)` exits zero. |
| `A4R-saveasset filename classification` | `saveasset-filename-classification` | Call `saveAsset(bytes)` or `saveAsset(..., '', '')` without a real filename and without a nearby `// audit:image-default` rationale. | Covered: failing fixture exits non-zero with `A4R-saveasset filename classification`; bypass fixture with `// audit:image-default` exits zero. |

## Suggested Next Proof

`A4R-saveasset filename classification`, `A4R-backup data dir inventory`,
`A4R-bounded process-lifetime accumulators`, `A4R7 asset URL gate`,
`A4R-fanout composite command race`, `A4R4 globally-addressed resolver normalize`,
Every A4R rule (`A4R1`–`A4R7` plus the `A4R-` named rules) and the EC rules
(`EC1`, `EC2`, `EC4`, `EC5`, `EC6`) now have committed fixtures. The remaining
open rules are the AEC structural invariants: `AEC2 import/export current
shape`, `AEC4 chat folder identity scope`, `AEC5 module reference semantics`,
and `AEC6 asset persistence semantics`. A good next target is `AEC4 chat folder
identity scope`: its fixture should prove that normalizing chat folder ids only
per-character (or omitting global duplicate-id rejection on create) exits
non-zero, while global folder-id normalization stays accepted.

## Commands

```sh
pnpm client-thinning:audit
pnpm exec vitest run util/client-thinning-audit.test.ts
```
