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
| `EC5 active-writer guard` | `active-writer-guard` | Move or omit `registerActiveWriterGuard`, add an unclassified mutating Fastify route, drop active-writer classifier needles, or remove client stale-writer handling from server chat/memory helpers. | Non-zero exit with `EC5 active-writer guard`. |
| `EC4 stable command ids` | `stable-command-ids` | Let command-path constructors mint `randomUUID()`, expose `promptTemplate` through generic settings commands, or allow command routes to mint durable ids from request payloads. | Non-zero exit with `EC4 stable command ids`. |
| `EC2 plugin storage gates` | `plugin-storage-gates` | Touch localStorage, plugin storage, or IndexedDB bridge methods without `assertDeviceLocalPluginStorageEnabled()`, expose `pluginV2`, or remove Fastify server/local save-mode separation. | Non-zero exit with `EC2 plugin storage gates`. |
| `EC6 asset walker validator drift` | `asset-walker-validator-drift` | Add an asset walker field without validator ownership, leave stale ownership for a removed walker field, or drop a required validator needle. | Non-zero exit with `EC6 asset walker validator drift`. |
| `AEC2 import/export current shape` | `import-export-current-shape` | Remove a block-export resource family, stop import normalization for a block-exported family, desync reserved root keys, or allow root component import to overwrite resource blocks. | Non-zero exit with `AEC2 import/export current shape`. |
| `AEC4 chat folder identity scope` | `chat-folder-identity-scope` | Normalize chat folder ids only per character, fail to update chat `folderId` references after repair, or omit global duplicate-id rejection on create surfaces. | Non-zero exit with `AEC4 chat folder identity scope`. |
| `AEC5 module reference semantics` | `module-reference-semantics` | Treat MCP modules as normal link targets, tolerate unresolved normal module ids, or skip module-link validation on chat create/patch/fork writes. | Non-zero exit with `AEC5 module reference semantics`. |
| `AEC6 asset persistence semantics` | `asset-persistence-semantics` | Stop healing missing asset blobs for existing metadata, reject documented clear values, or omit optional audio asset reference validation from character commands. | Non-zero exit with `AEC6 asset persistence semantics`. |
| `EC1 provider ownership` | `provider-ownership` | Reintroduce browser provider fallback in Fastify mode, allow Fastify preview bodies without explicit support, permit browser Vertex projection writes in Fastify mode, or expose `useServerGeneration` as a server setting command. | Non-zero exit with `EC1 provider ownership`. |
| `A4R1 passive refresh writer ownership` | `passive-refresh-writer-ownership` | Make a read-only bootstrap helper attach `activeWriterSessionHeader()` or call the writer-registering bootstrap helper from a passive refresh path outside `WRITER_BOOTSTRAP_CALLERS`. | Non-zero exit with `A4R1 passive refresh writer ownership`. |
| `A4R2 conflict replay outside central wrapper` | `conflict-replay` | Branch on `result.status === 'conflict'` outside `runServerCommand` and then resend a mutating command with `baseRevision` through a command helper or fetch. | Non-zero exit with `A4R2 conflict replay outside central wrapper`. |
| `A4R3 transitive command-path id minting` | `transitive-command-id-minting` | Mint ids directly in a `/api/v1/commands/*` route, call a `repair*` id-minting helper from a command route, pass request-derived data to `ensure*`/`normalize*`, or call an unclassified transitive minter. | Non-zero exit with `A4R3 transitive command-path id minting`. |
| `A4R4 globally-addressed resolver normalize` | `resolver-normalize` | Call `requireChatLocation()` or `requireMessageLocation()` before the matching global normalizer in the same handler/helper scope. | Non-zero exit with `A4R4 globally-addressed resolver normalize`. |
| `A4R5 asset reference parser parity` | `asset-reference-parser-parity` | Change the client `LOCAL_ASSET_PATH_RE` without the server walker accepting the same regex shape, or remove the walker `addReference` parity surface. | Non-zero exit with `A4R5 asset reference parser parity`. |
| `A4R6 wildcard secret row identity` | `wildcard-secret-row-identity` | Add a wildcard object-array secret path without `ARRAY_ROW_IDENTITY_KEYS`, add an unclassified flat string-array secret, or let wildcard placeholder resolution skip the rejected-row sentinel. | Non-zero exit with `A4R6 wildcard secret row identity`. |
| `A4R7 asset URL gate` | `asset-url-gate` | Let Fastify asset-byte helpers fetch arbitrary `loc` values with `risu-auth`, fall back to `?? loc` for unknown shapes, or omit the explicit empty/null/throw default for unknown asset shapes. | Covered: authenticated arbitrary-`loc` fetch and Fastify `?? loc` fallback fixtures exit non-zero with `A4R7 asset URL gate`; documented-shapes bypass exits zero. |
| `A4R-fanout composite command race` | `composite-command-fanout` | Dispatch two or more mutating command helpers in one scope without awaiting each previous call or routing through `runChatCommandSequence`/`runOptimisticCommandSequence`. | Covered: failing fixture exits non-zero with `A4R-fanout composite command race`; bypass fixture (sequencer-routed and awaited-chain shapes) exits zero. |
| `A4R-backup data dir inventory` | `backup-data-dir-inventory` | Add a child to `KNOWN_DATA_DIR_CHILDREN` without referencing it in both `createBackup` and `restoreBackup`, or remove the inventory declaration. | Covered: failing fixture exits non-zero with `A4R-backup data dir inventory` and the missing create/restore references. |
| `A4R-bounded process-lifetime accumulators` | `bounded-process-lifetime-accumulators` | Declare an exported top-level `Set`, `Map`, or `Array` under `server/fastify/src/` without bounded classification, or remove visible eviction from a declared accumulator. | Covered: failing fixture exits non-zero with `A4R-bounded process-lifetime accumulators`; bypass fixture with `// audit:bounded(...)` exits zero. |
| `A4R-saveasset filename classification` | `saveasset-filename-classification` | Call `saveAsset(bytes)` or `saveAsset(..., '', '')` without a real filename and without a nearby `// audit:image-default` rationale. | Covered: failing fixture exits non-zero with `A4R-saveasset filename classification`; bypass fixture with `// audit:image-default` exits zero. |

## Suggested Next Proof

`A4R-saveasset filename classification`, `A4R-backup data dir inventory`,
`A4R-bounded process-lifetime accumulators`, `A4R7 asset URL gate`, and
`A4R-fanout composite command race` are complete. Continue with the remaining
ordering-sensitive A4R rules unless source inventory reveals a more urgent rule
gap. `A4R4 globally-addressed resolver normalize` is a good next small target:
its fixture should prove that calling `requireChatLocation()` or
`requireMessageLocation()` before the matching global normalizer in the same
scope exits non-zero, while the normalize-then-resolve order remains accepted.

## Commands

```sh
pnpm client-thinning:audit
pnpm exec vitest run util/client-thinning-audit.test.ts
```
