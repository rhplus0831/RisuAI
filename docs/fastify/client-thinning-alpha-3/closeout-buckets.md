# Closeout Buckets

Date: 2026-05-28

This is the suggested task-agent breakdown for Alpha 3. Each bucket should land
behavior, focused tests, audit coverage where practical, and doc updates before
being marked closed.

Current status: **open.**

Rule-first gate: Bucket 0 lands before behavior closeout. No behavior bucket may
be marked closed until its corresponding R rule fails on the pre-fix tree and
passes after the fix. Findings without a dedicated R rule still need a focused
failing-then-passing regression test or an explicit tested contract decision.

| Order | Bucket                                   | Closes                                                                       | Primary ownership                                                                                                                                                                                                                                    |
| ----- | ---------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Audit rules R1-R7 and exclusions         | A3EC6 gate for A3F1, A3F2, A3F3, A3F4, A3F5, A3F6 overlap, A3F7, A3F9, A3F11 | `util/client-thinning-audit.ts`, audit tests/fixtures where available, this folder's docs                                                                                                                                                            |
| 1     | Active-writer and conflict semantics     | A3F1, A3F2, A3F12                                                            | `src/ts/bootstrap.ts`, `src/ts/server/bootstrap.ts`, `server/fastify/src/routes/bootstrap.ts`, `src/ts/setting/utils.ts`, `src/ts/server/commands.ts`, compatibility command adapters, active-writer/settings tests, `util/client-thinning-audit.ts` |
| 2     | Stable-id command holes                  | A3F3, A3F4                                                                   | preset copy/import command contracts, lorebook delete behavior, server/client command helpers, command tests, `util/client-thinning-audit.ts`                                                                                                        |
| 3     | Global id addressing                     | A3F5                                                                         | chat/message command helpers, import/bootstrap normalization, command route tests, audit checks                                                                                                                                                      |
| 4     | Asset ownership and backup durability    | A3F6, A3F7, A3F8, A3F9, A3F10                                                | `src/ts/server/assets.ts`, `src/ts/globalApi.svelte.ts`, preset import, `server/fastify/src/repository.ts`, RisuSave walker/bundle export, backup and asset tests, audit checks                                                                      |
| 5     | Secret placeholder row identity          | A3F11                                                                        | `server/fastify/src/providerSecrets.ts`, settings command tests, masking tests, audit checks                                                                                                                                                         |
| 6     | Event retention and final audit closeout | A3F13, A3EC6 docs                                                            | `server/fastify/src/commands/events.ts`, event tests, `docs/fastify/client-thinning-alpha-3/*`, top-level status docs after full ladder                                                                                                              |

## Parallelization Notes

- Bucket 1 should land before broad status docs are touched because it changes
  the active-writer contract.
- Buckets 2 and 3 both touch command id semantics and may conflict in
  `server/fastify/src/routes/commands.ts`; sequence them or split by file with a
  narrow integration owner.
- Bucket 4 is mostly independent except for preset import, which overlaps with
  Bucket 2. Decide whether preset import id validation and asset validation move
  together.
- Bucket 5 is independent from command id work but should update the audit to
  prevent future masked-array placeholder regressions.
- Bucket 6 should close last, after the full verification ladder passes.
- A3F5 no longer includes chat folders. Folder global uniqueness is already
  covered by `normalizeGlobalChatFolderIds` and audit rule AEC4
  (`util/client-thinning-audit.ts:1071-1105`).

## Expected Closeout Ladder

Run focused tests for each bucket, then the shared ladder before marking Alpha 3
closed:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

## Audit Coverage Targets

Extend `util/client-thinning-audit.ts` with these rule-first gates:

- R1: passive refresh cannot use a writer-registering bootstrap helper.
- R2: conflict retry code cannot resend the same patch with `currentRevision`
  outside the central command wrapper.
- R3: public command routes cannot use imported repair helpers that can mint ids,
  unless an explicit audited server-generated-id exception exists.
- R4: globally resolving chat/message helpers cannot pair with create/import
  paths that only enforce parent-local uniqueness.
- R5: RisuSave asset walking must match client asset-reference parsing, or the
  narrower server contract must be enforced at import/command boundaries.
- R6: masked secret placeholder restoration over arrays requires stable row
  identity or rejection.
- R7: asset helpers cannot fetch arbitrary references with `risu-auth`.

A3F8, A3F10, A3F12, and A3F13 may close with focused regression tests and
documented contract decisions unless the implementation reveals a reusable audit
pattern.
