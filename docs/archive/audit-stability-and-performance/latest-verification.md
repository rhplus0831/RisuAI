# Latest Verification

Date: 2026-06-05

This is the maintained proof-command log for the workstream. Update it after
each future change to a narrowed or bounded path.

## Final State

- Plan state: closed. Phases 0-8 are complete.
- Final full run: `pnpm test` 1132/4 (122 files), `pnpm api:test` 1737/1
  (99 files), `pnpm client-thinning:audit` green, both TypeScript checks zero
  errors.
- Gate state: every scheduled ID is `DONE`; no `PLANNED` entries remain.
- Open gated IDs: L4, L7, L26, U2. U3 remains no-action.

## Baseline

Phase 0 added the fixture, server load-count harness, and fix-completeness
gate. It made no runtime change.

- `pnpm test`: 1067 passed / 4 skipped.
- `pnpm api:test`: 1639 passed / 1 skipped.
- `pnpm client-thinning:audit`: green.
- TypeScript: `tsconfig.client-lib.json` and `server/fastify/tsconfig.json`
  both zero errors.
- Pre-slice baseline through `6861494d`: 1054/4 client, 1632/1 server, audit
  green, zero TypeScript errors. `pnpm check` had a pre-existing 10-error
  svelte-check baseline outside this workstream.

## Fixture Measurements

Recorded on 2026-06-04 from the shared large-corpus fixture.

- Scoped hot-chat hydration: 0 corpus loads.
- H1 fallback hydration before the fix: 13 whole-corpus payload loads for one
  chat's messages.
- Scale run: hot-chat scoped hydration was ~8ms. No-hypa fallback hydration was
  ~13ms despite a smaller chat because it parsed the corpus.
- Durable gate signal: load count. Timings explain why the count matters.

## Post-Fix Highlights

- Phase 1 H1: no-hypa chat hydration now has 0 corpus loads and ~1.6ms on the
  default fixture.
- Phase 1 H2: chat select captures zero clone-primitive calls instead of
  cloning all characters.
- Phase 1 H3: a synthetic 200-token stream performs at most 2 display
  parses/writes instead of 200.
- Phase 2 M1/L1/L2: preview/send assembly performs zero whole-corpus
  `messages`/`chat_hypa_v3` reads.
- Phase 2 M3/L5/L6: message/scriptstate/generation mutations perform zero
  whole-corpus payload reads.
- Phase 2 M4: `characterRow` projection performs zero whole-corpus payload
  reads.
- Phase 2 M5/L10/U1: metrics-off responses serialize once; no-replay SSE and
  bulk hydration avoid corpus reads.
- Phase 3: var writes skip redundant normalization; rollback paths capture one
  row/chat; scoped watchers avoid sibling serialization.
- Phase 4: proxy disconnect aborts upstream; non-durable provider bodies cap at
  32 MB; Lua receives abort signals; streaming buffers cap at 8 MB.
- Phase 5: inflate aborts at the cap; GC/report avoid message corpus
  hydration; bundle abort frees resources; restore/replay/reattach paths are
  atomic or re-armed.
- Phase 6: memory ticks drain at most 32 jobs; contextual sub-batches commit
  independently; Lua uses an aggregate budget and warm pool.
- Phase 7: script/lorebook/trigger regexes compile once per bounded pass;
  prune/delete/logging/transcript-scan cleanup is covered by regression tests.

## Reproducing Cost Checks

- Server stage timings: run focused server tests with `RISU_PROTOCOL_METRICS=1`
  and `RISU_COMMAND_METRIC_SUMMARY=1`. Watch `databaseLoad*`,
  `projection_response`, and command metrics.
- Static corpus cost: `pnpm analyze:db <input>`.
- Client streaming cost: profile a long streamed response. Before H3,
  `ParseMarkdown` / `risuChatParser` self-time grew with message length. After
  H3, parse count is bounded by render flushes.
- Client protocol logs:
  `localStorage.setItem('risu:protocol-debug','1')`.

## Run Log

- 2026-06-04, plan opened: baseline carried from `6861494d`; no runtime change.
- 2026-06-04, Phase 0 measurement harness: `pnpm test` 1059/4,
  `pnpm api:test` 1639/1, audit green, TypeScript clean.
- 2026-06-04, Phase 0 gate scaffold: `pnpm test` 1067/4, audit green,
  TypeScript clean. Drift checks hand-verified.
- 2026-06-04, Phase 1 H1 (`0dc7452e`): `pnpm api:test` 1640/1,
  `pnpm test` 1067/4, audit green, TypeScript clean.
- 2026-06-04, Phase 1 H3 (`e41dc6c6`): `pnpm test` 1077/4,
  `pnpm api:test` 1640/1, audit green, TypeScript clean.
- 2026-06-04, Phase 1 H2 (`067ab82a`): `pnpm test` 1084/4,
  `pnpm api:test` 1640/1, audit green, TypeScript clean. Phase 1 complete.
- 2026-06-04, Phase 2 scoped assembly (`c193c008`): `pnpm api:test` 1651/1,
  `pnpm test` 1084/4, audit green, TypeScript clean.
- 2026-06-04, Phase 2 command mutation (`e0e86ab1`): `pnpm api:test` 1657/1,
  `pnpm test` 1084/4, audit green, TypeScript clean.
- 2026-06-04, Phase 2 character projection (`254b3112`): `pnpm api:test`
  1664/1, `pnpm test` 1084/4, audit green, TypeScript clean.
- 2026-06-04, Phase 2 metrics/bulk (`b2765994`): `pnpm api:test` 1671/1,
  `pnpm test` 1084/4, audit green, TypeScript clean. Phase 2 complete.
- 2026-06-04, Phase 3 client clone batch (`0efa7ba6`): `pnpm test` 1117/4,
  `pnpm api:test` 1671/1, audit green, TypeScript clean. L32 follow-up still
  needed.
- 2026-06-04, Phase 3 L32 follow-up: focused client run brought the suite to
  1121/4; `pnpm client-thinning:audit` and both TypeScript checks passed.
  Phase 3 complete.
- 2026-06-05, Phase 4 outbound lifecycle (`bf1a6cb2`): `pnpm api:test`
  1692/1, `pnpm test` 1121/4, audit green, TypeScript clean. Phase 4 complete.
- 2026-06-05, Phase 5 materialization/lifecycle (`686220d6`):
  `pnpm api:test` 1714/1, `pnpm test` 1122/4, audit green, TypeScript clean.
  Phase 5 complete.
- 2026-06-05, Phase 6 memory/Lua (`ca798c01`): `pnpm api:test` 1728/1,
  `pnpm test` 1122/4, audit green, TypeScript clean. Phase 6 complete.
- 2026-06-05, Phase 7 memoization/hygiene (`151c6978`): `pnpm api:test`
  1737/1, `pnpm test` 1130/4, audit green, TypeScript clean. Phase 7 complete.
- 2026-06-05, Phase 8 closing full run: `pnpm test` 1132/4, `pnpm api:test`
  1737/1, `pnpm client-thinning:audit` green, TypeScript clean. Plan closed.
