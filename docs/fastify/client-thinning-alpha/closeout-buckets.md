# Closeout Buckets

Date: 2026-05-28

This is the task-agent work breakdown for the alpha findings. Each bucket closes
one or more findings from [`open-findings.md`](./open-findings.md). A bucket is
done only when code, focused tests, relevant audit-script coverage, and docs are
all updated.

Current pickup: **Bucket 1.** It closes the highest-risk invariant blind spot and
should land before any final alpha closeout claim.

| Order | Bucket | Closes | Status | Primary ownership |
| --- | --- | --- | --- | --- |
| 1 | Root create id validation + audit expansion | AEC1 / AF1 | Open | `server/fastify/src/commands/*`, `server/fastify/src/routes/commands.ts`, `server/fastify/__tests__/commands.test.ts`, `util/client-thinning-audit.ts` |
| 2 | JSON import/export current-shape parity | AEC2 / AF2 | Open | `server/fastify/src/routes/save.ts`, `server/fastify/src/risuSave/importSnapshot.ts`, `server/fastify/src/risuSave/exportSnapshot.ts`, import/export tests |
| 3 | Preset image validation + walker audit parity | AEC3 / AF3 | Open | `server/fastify/src/commands/presets.ts`, preset routes/tests, `server/fastify/src/risuSave/assetReferences.ts`, `util/client-thinning-audit.ts` |
| 4 | ROOT_COMPONENT reserved-key guard | AEC2 / AF4 | Open | `server/fastify/src/risuSave/importSnapshot.ts`, `.risu` import tests |
| 5 | Chat folder identity scope | AEC4 / AF5 | Open | `server/fastify/src/routes/commands.ts`, `server/fastify/src/commands/chats.ts`, command tests |
| 6 | Module reference and MCP boundary semantics | AEC5 / AF6, AF7 | Open | `server/fastify/src/commands/chats.ts`, `server/fastify/src/commands/modules.ts`, prompt/module tests |
| 7 | Asset blob healing + optional clear tests | AEC6 / AF8, AF10 | Open | `server/fastify/src/repository.ts`, `server/fastify/src/routes/assets.ts`, command/assets tests |
| 8 | Documentation/status reconciliation | AEC7 / AF9 | Open | `docs/fastify/client-thinning-alpha/*`, relevant historical status docs |

## Parallelization notes

- Buckets 1 and 3 both touch `util/client-thinning-audit.ts`; coordinate if they
  run in parallel.
- Buckets 2 and 4 both touch import normalization and should either be sequenced
  or assigned to the same task agent.
- Bucket 8 should be last unless a task agent is only updating this alpha
  directory while implementation is still open.

## 1. Root create id validation + audit expansion

Goal: close AF1 and make the audit catch the full root-create class.

Required implementation:

- Split command create validation from import repair where helpers currently use
  missing-id `randomUUID()` fallbacks.
- Require ids on public create paths for characters, presets, personas,
  translator presets, loadouts, modules, chats/chat folders, and lorebooks unless
  the route is explicitly import/clone repair and documented as such.
- Extend `util/client-thinning-audit.ts` so all command-path create helpers are
  covered by the no-mint rule.

Focused proof:

```bash
pnpm api:test server/fastify/__tests__/commands.test.ts -- --run
pnpm client-thinning:audit
```

Done when missing-id public create requests return 400 and import/bootstrap
repair still normalizes legacy missing ids.

## 2. JSON import/export current-shape parity

Goal: close AF2.

Required implementation:

- Make JSON import persist a database shape that satisfies block export's
  required top-level collection contract, or reject insufficient shapes before
  persistence.
- Add tests for `{ database: { v: 1 } }` and for missing resource-family arrays
  that export currently requires.
- Keep `.risu` multipart import and JSON import on one shared normalizer where
  possible.

Focused proof:

```bash
pnpm api:test server/fastify/__tests__/risuSaveImportRoute.test.ts -- --run
pnpm api:test server/fastify/__tests__/risuSaveExportRoute.test.ts -- --run
```

## 3. Preset image validation + walker audit parity

Goal: close AF3 and the EC7 walker blind spot.

Required implementation:

- Validate `botPresets[*].image` on preset create and patch.
- Add malformed, missing, valid, and clear-value tests for preset image.
- Extend the asset walker audit so it enumerates every top-level walked field,
  including `botPresets[*].image`.

Focused proof:

```bash
pnpm api:test server/fastify/__tests__/commands.test.ts -- --run
pnpm client-thinning:audit
```

## 4. ROOT_COMPONENT reserved-key guard

Goal: close AF4.

Required implementation:

- Decide whether reserved top-level keys are rejected, ignored, or normalized
  through family-specific handlers when found in ROOT_COMPONENT blocks.
- Add import tests that attempt to overwrite a reserved resource-family key and
  then export the result.
- Keep non-reserved ROOT_COMPONENT fields working.

Focused proof:

```bash
pnpm api:test server/fastify/__tests__/risuSaveImportRoute.test.ts -- --run
```

## 5. Chat folder identity scope

Goal: close AF5.

Required implementation:

- Enforce globally unique chat folder ids on command create, matching the
  existing `/:folderId` patch/delete route shape.
- Add legacy/import repair for duplicate folder ids if persisted data can contain
  them.
- Add tests where two characters try to use the same folder id and where
  patch/delete targets the intended folder.

Focused proof:

```bash
pnpm api:test server/fastify/__tests__/commands.test.ts -- --run
```

## 6. Module reference and MCP boundary semantics

Goal: close AF6 and AF7.

Required implementation:

- Validate `chat.modules` against the chosen module scope on command writes, or
  explicitly document/test unresolved ids as intentional compatibility state.
- Define whether MCP module ids are linkable through normal character/chat
  module commands. The default alpha decision is no: normal module links target
  normal user modules.
- Add tests for nonexistent module ids and MCP module ids.

Focused proof:

```bash
pnpm api:test server/fastify/__tests__/commands.test.ts -- --run
pnpm test src/ts/server/commands.test.ts -- --run
```

## 7. Asset blob healing + optional clear tests

Goal: close AF8 and AF10.

Required implementation:

- Make re-upload heal an existing asset metadata row whose blob file is missing,
  or document a different explicit durability model and test it.
- Add optional-clear tests for `null`, `""`, and `"-"` on
  `vits.files.*` and `gptSoVitsConfig.ref_audio_data.assetId`.

Focused proof:

```bash
pnpm api:test server/fastify/__tests__/commands.test.ts -- --run
pnpm api:test server/fastify/__tests__/assets.test.ts -- --run
```

## 8. Documentation/status reconciliation

Goal: close AF9 and prepare final alpha closeout.

Required implementation:

- Move closed findings from [`open-findings.md`](./open-findings.md) to
  [`history.md`](./history.md) as buckets land.
- Update this file's status table.
- Reconcile stale open/closed claims in historical docs or mark them clearly as
  historical snapshots.
- Refresh [`final-audit.md`](./final-audit.md) after the full ladder passes.

Focused proof:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```
