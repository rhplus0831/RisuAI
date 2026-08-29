# Phase 13 — Consolidation, Adjudication, And Remediation

Status: In progress
Depends on: Phases 0-12

## Objective

Turn completed domain inventories into one deduplicated, decision-complete,
bounded remediation queue; land shared structural gates and fix waves without
reopening discovery or allowing one regression test to bless an unsigned policy.

## Required Work

1. Map every raw report exactly once and merge duplicates by observable cause,
   not merely shared files.
2. Independently re-verify every Critical/High and every single-track finding.
3. Split multi-observable findings when remediation or authority differs.
4. Present each `decide` item with baseline/current evidence, user/data impact,
   parity option, migration cost, proposed behavior, tests, and revisit trigger.
5. Sequence remediation by shared mechanism and blast radius: data-loss and
   security first, then request/prompt correctness, lifecycle/recovery,
   interchange, and visible/diagnostic mismatches.
6. Land closed-world gates before or with fixes when they prevent the same
   omission class.
7. Re-run affected domain evidence after every shared harness, fixture,
   normalizer, persistence, or protocol change.

## Required Outputs

- Canonical findings/decisions with no orphan raw reports or duplicate ownership.
- Signed decision records for all accepted differences.
- Bounded remediation slices with exact inventory rows, rollback, regression
  proof, verification commits, and residual risks.
- Shared structural gates and updated current architecture/test documentation.
- Phase 14 run manifest with exact commands, prerequisites, and artifacts.

## Exit Criteria

- No unowned pending finding, unsigned expected difference, or silent
  unsupported surface remains.
- Critical/High findings are resolved or individually accepted with authority
  and revisit rules.
- Every implementation change has focused regression proof and updated
  inventory/finding state.
- All Phase 14 prerequisites and final test selections are reproducible.

## Validation

Each remediation slice runs focused tests, `pnpm test:affected --dry-run` and all
selected lanes, required domain/compatibility/browser gates, formatting, and
`git diff --check`. Broad harness/runner changes also run complete owning lanes
and `pnpm test:all` as required by `PLAN.md`.

## Execution Record

The consolidation pass found no duplicate canonical findings, orphan raw
reports, proposed decisions, or newly reproducible incompatibilities. Commit
`473f88478a22ce3bb851e5ab3e1323addd15fbbf` makes register closure executable:
all four registers must agree on lifecycle state, and `closed` rejects
unfinished inventory, findings, decisions, upstream units, missing current
evidence, and phase-owned re-verification placeholders. Commit
`7bf742dd0e8bb37aa6d29fc40c97c4f49fbace5d` independently closes the last six
mapped Category D rows and refreshes every historical finding at its owning
domain verification anchor.

### Upstream Current-Verification Audit

Every unit in `71c476e9c..f3f0242fb` was compared with current production owners,
direct regression owners, signed no-port authority, and the completed domain
matrices. Mixed units 058 and 081 were adjudicated component by component so a
verified component cannot hide a retired or signed-divergent component.

| Current disposition | Units | Current proof |
| --- | --- | --- |
| Verified Plugin V3 API, provider identity, lifecycle, and output listeners | 002, 014, 046, 067, 069, 075, 076, 083 | `src/ts/plugins/apiV3/v3.svelte.test.ts`, `src/ts/plugins/apiV3/factory.test.ts`, `src/ts/process/request/tests/pluginProviderModelId.test.ts`, `src/ts/process/serverBackedSendChat.findMessage.test.ts`, and Category J anchor `e8bbbeea6ad400234aa4d0abad330356265c3c23` |
| Verified hydration, rendering, authoring, and chat behavior | 003, 071, 074, 079, 082 | `src/ts/server/chatMessageHydration.test.ts`, `src/ts/process/__tests__/streamCoalescer.test.ts`, sidebar drag tests, `src/ts/characterCommands.test.ts`, color-scheme tests, and Category B/D/E anchors |
| Verified CBS, prompt-role, lore cutoff, and Lua/trigger behavior | 005, 058, 060, 061, 063, 065, 070, 085 | Phase 6/9 closed-world gates plus prompt-template, lorebook, Lua, trigger-variable, and chat-variable regressions; unit 058 separately excludes reverted lore-role, retired V2-plugin cache, Tauri cleanup, and test-only components |
| Verified provider/model/options behavior | 006, 010, 011, 013, 015, 019, 049, 051, 078, 080, 081, 084 | OpenAI, Responses, Anthropic, Gemini, additional-parameter, Realm-proxy, sanitizer, and profile-option wire tests; unit 081 retains dynamic OpenAI discovery only as signed `ORC-DECISION-059` |
| Verified local-backup stale-chunk replacement path | 012 | Backup settings now use the stable Fastify local-backup endpoint and Blob download rather than StreamSaver; backup, lazy-first-open, LazyComponent recovery, and real browser download/restore tests own the behavior |
| Verified signed character/module conversion no-port | 021-029, 037, 039, 052 | `ORC-SURFACE-062`, signed `ORC-DECISION-058`, and the Phase 10 exact absence/`.risum` ownership gate |
| Verified quality workflow | 073 | `.github/workflows/quality.yml` and the Phase 1 aggregate/cadence gate |
| Current product exclusion: retired browser-local, Account/Drive sync, Tauri, V2-plugin, or superseded behavior | 001, 004, 008, 009, 016, 017, 020, 033-035, 040-042, 044, 047, 054, 055, 057, 068, 072, 077 | `docs/structure/generated-and-legacy.md`, Phase 10/12 exact absence gates, and signed decisions `ORC-DECISION-068` through `071`; retained Fastify backup/cold-archive recovery remains separately tested |
| Current product exclusion: version-only churn | 018, 030, 032, 036, 038, 043, 045, 048, 050, 053, 056, 059, 062, 064, 066 | Current version ownership in `package.json`, `version.json`, and the Fastify Alpha/Tauri-removal history; no user-visible fork behavior |
| Current product exclusion: reverted upstream changes | 007, 031 | Exact upstream ancestry and current checkbox/toggle ownership; the character-toggle fragment of unit 031 is already governed by `ORC-DECISION-058` |

The 47 verified and 38 not-applicable outcomes exhaust all 85 units. The
StreamSaver audit for unit 012 also found that non-JSON character-card export
still lazy-loads StreamSaver; this is outside the backup unit and remains a
generic feature-load failure rather than a reproduced compatibility mismatch.
Its owner is `src/ts/globalApi.downloadFile.test.ts`, and the condition must be
revisited if a stale deployed chunk is reproduced on that export path.

### Phase 14 Run Manifest

Prerequisites are Node `v24.19.0`, pnpm `11.23.0`, a clean detached baseline at
`/home/codex/risu-baseline-71c476e9c`, available browser binaries, and no moving
upstream checkout as output authority. Run from the repository root in this
order and retain terminal logs plus the compatibility artifacts named by the
harness:

```sh
pnpm prepare:compat-baseline
pnpm exec tsx util/compat-baseline.ts --check
pnpm validate:compat-registers
pnpm test:affected --dry-run
pnpm test:affected
pnpm test:compat-current
pnpm test:compat-harness
pnpm test:all
pnpm smoke:fastify-browser
pnpm build:initial-preload
pnpm check
pnpm check:server
pnpm check:protocol
pnpm format:check
git diff --check
```

`latest-verification.md` must record the exact verification commit, toolchain,
baseline state, per-command counts, pinned differential cell/divergence counts,
built-browser result, bundle-boundary reports, and any retained residual before
the registers change to `closed` or the workstream moves to the archive.
