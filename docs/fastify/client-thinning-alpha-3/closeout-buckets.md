# Closeout Buckets

Date: 2026-05-28

This is the ordered task-agent breakdown for Alpha 3. Each bucket landed
behavior, focused tests, audit coverage where practical, and doc updates before
being marked closed.

Current status: **closed.** Buckets 0, 1, 2, 3, 4, 5, and 6 have landed. Bucket 1
clears A3F1, A3F2, and A3F12. Bucket 2 clears A3F3, A3F4, and the A3F6
preset-import validator overlap. Bucket 3 clears A3F5 global chat/message
addressing; Bucket 4 clears A3F7, A3F8, A3F9, and A3F10. Bucket 5 clears A3F11
masked array secret row identity. Bucket 6 clears A3F13 command event
retention and final docs/status closeout. `pnpm client-thinning:audit` passes
all Alpha 3 R1-R7 gates.

Rule-first gate: Bucket 0 lands before behavior closeout. No behavior bucket may
be marked closed until its corresponding R rule fails on the pre-fix tree and
passes after the fix. Findings without a dedicated R rule still need a focused
failing-then-passing regression test or an explicit tested contract decision.

| Order | Bucket                                   | Closes                                                                       | Primary ownership                                                                                                                                                        |
| ----- | ---------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | Audit rules R1-R7 and exclusions         | A3EC6 gate for A3F1, A3F2, A3F3, A3F4, A3F5, A3F6 overlap, A3F7, A3F9, A3F11 | Landed in `util/client-thinning-audit.ts`; current audit status is documented below.                                                                                     |
| 1     | Active-writer and conflict semantics     | A3F1, A3F2, A3F12                                                            | Landed. Passive refresh is read-only, generic settings conflicts roll back without replay, and whole-chat compatibility command fan-out is serialized.                   |
| 2     | Stable-id command holes                  | A3F3, A3F4, A3F6 preset-import overlap                                       | Landed. Preset copy/import no longer mint ids, last-lorebook delete returns 400, and preset import validates image asset refs.                                           |
| 3     | Global id addressing                     | A3F5                                                                         | Landed. Chat/message ids are globally normalized or rejected on command writes while the public globally addressed route contract remains unchanged.                     |
| 4     | Asset ownership and backup durability    | A3F7, A3F8, A3F9, A3F10                                                      | Landed. Authenticated asset reads reject unknown refs, bundle walking includes legacy asset paths, backups preserve asset bytes, and ONNX upload metadata is retained.   |
| 5     | Secret placeholder row identity          | A3F11                                                                        | Landed. Masked array placeholders restore by stable row identity or reject missing/duplicated/unknown row identity, with provider settings and masking regression tests. |
| 6     | Event retention and final audit closeout | A3F13, A3EC6 docs                                                            | Closed. `InMemoryCommandEventSink` retains the latest 1000 events, focused event tests prove retention/fanout behavior, and top-level status docs point to Alpha 3.       |

## Parallelization Notes

- Bucket 1 should land before broad status docs are touched because it changes
  the active-writer contract.
- Buckets 2 and 3 both touched command id semantics in
  `server/fastify/src/routes/commands.ts`; future command-id changes should
  check those helpers before adding parent-local duplicate guards.
- Bucket 2 resolved the preset import overlap by moving the route to
  `createPresetRecord`, so Bucket 4 can focus on asset reads, backups, bundle
  walking, and upload metadata.
- Bucket 5 is independent from command id work and now prevents masked-array
  placeholder regressions through R6 plus focused tests.
- Bucket 6 closed last after the full verification ladder passed.
- A3F5 no longer includes chat folders. Folder global uniqueness is already
  covered by `normalizeGlobalChatFolderIds` and audit rule AEC4
  (`util/client-thinning-audit.ts:1071-1105`).

## Expected Closeout Ladder

Focused tests landed for each bucket, then the shared ladder passed before Alpha
3 was marked closed:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

## Audit Coverage Targets

`util/client-thinning-audit.ts` now contains these rule-first gates:

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

## Current Audit Output

`pnpm client-thinning:audit` currently passes all Alpha 3 R1-R7 gates.

Next agent: Alpha 3 is closed. Start new Fastify client-thinning work only if a
fresh finding appears, and record it outside this closed Alpha 3 bucket list.
