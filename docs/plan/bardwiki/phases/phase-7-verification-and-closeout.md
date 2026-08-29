# Phase 7: Verification and Closeout

Status: complete.

Goal: prove the completed BardWiki system across persistence, commands,
generation, prompt assembly, jobs, UI, lifecycle, recovery, security,
performance, and documentation, then close and archive the workstream.

## Completion Note

The complete affected workflow expanded to `test:all` and passed every lane:
6,619 frontend tests, 3,513 server tests plus the isolated Realm scale case,
206 UI coverage tests, 38 Playwright scenarios, six frontend performance-gate
tests, protocol/client/Fastify/browser-smoke typechecks, Svelte diagnostics,
and repository formatting. The focused BardWiki matrices passed 100 server and
658 client/protocol tests.

The closeout added the visible explicit-confirmation action/status, filled the
protocol fixture and server mutation-metric gates exposed by the first aggregate
run, added the BardWiki lifecycle browser journey, documented every current
owner, and measured both a bounded prompt selection and body-free workspace
projection over 2,000 documents. No temporary rollout bypass remains and no
accepted correctness gap is carried forward. Exact commands, behavior-to-test
mapping, measurements, and caveats are in
[`../latest-verification.md`](../latest-verification.md).

Phase 7 commits:

- `16019e1d1` closes the protocol/UI fixture and server mutation-metric gates.
- `01809a845` exposes safe current-turn confirmation in the workspace.
- `88cd140a2` adds the BardWiki lifecycle browser smoke journey.
- `47dcdb1b3` documents the shipped architecture across current guides.
- `99fe03c1c` records the representative body-free workspace projection.

Validation on 2026-08-29:

```text
pnpm test:affected --base origin/fastify --include-smoke
# Expanded to test:all; every lane passed in 4m 49.7s.
# Frontend 536 files / 6,619 tests; server 169 files / 3,513 passed,
# browser 38; UI coverage 6 files / 206 tests; performance 2 files / 6 tests.

pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/bardWiki*.test.ts
# 14 files, 100 tests passed

# Focused protocol/client BardWiki matrix: 14 files, 658 tests passed.
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
# Passed with no diagnostics.
```

## Depends On

- Phases 0-6 are complete with no unrecorded correctness gaps.

## Scope

- Audit the shipped implementation against every invariant and exit criterion in
  [`../PLAN.md`](../PLAN.md) and the phase files.
- Run focused and owning-lane server/client tests for all touched domains.
- Run the repository TypeScript workflow and affected-test workflow.
- Run browser smoke for settings, workspace, manual edit, confirmation/job
  status, prompt use, and recovery paths that require visible integration proof.
- Test server restart during pending/running/committed-before-complete jobs.
- Test active-writer loss, revision conflict, command replay, SSE reconnect, and
  resource refresh.
- Verify model timeout/cancel/retry, request-history masking, and routine metric
  privacy.
- Verify prompt output/budget behavior for disabled, BardWiki, Hypa, and Hybrid
  configurations.
- Verify backup/restore, import/export, delete/fork, rebuild, and derived-index
  recovery end to end.
- Measure prompt retrieval and workspace loading against bounded representative
  corpora and record results without inventing unsupported guarantees.
- Update current architecture, settings, chat, generation, prompt, data/events,
  assets/saves, testing, and localization documentation as appropriate.
- Create `latest-verification.md` with exact commands, dates, counts, caveats,
  and residual gaps.
- Remove temporary rollout scaffolding only when compatibility and rollback
  expectations permit it.
- Mark the plan closed and move it intact to `.archived-docs/` under the
  appropriate memory/product category.

## Required Behavior Matrix

| Area | Required proof |
| --- | --- |
| Manual documents | CRUD, version conflict, reload, cross-chat isolation, revision/event replay. |
| Confirmation | Explicit current turn and automatic prior turn; no regenerate/continue/current-send ingestion. |
| Jobs | Fair lanes, retry, cancel, restart, post-commit replay, retention, sanitized status. |
| Model writes | Strict schema, bounded repair, atomic event/canon changes, manual-edit conflict. |
| Source mutation | Pending obsolete, applied stale, safe inverse or review, rebuild recovery. |
| Prompt | Deterministic ranking, link expansion, budgets, preview/provider parity, disabled parity. |
| UI | Settings tab, chat workspace, mobile/a11y, queued/failed/conflict/review states. |
| Lifecycle | Delete, truncate, alternate, fork, import/export, exact restore, rebuild. |
| Security/privacy | Auth/writer/limits/path safety, secret masking, no raw docs in routine telemetry. |
| Performance | Bounded prompt selector, lazy document bodies, no Hypa starvation or generation wait. |

## Validation Strategy

Use the affected-test selector first and retain every focused BardWiki suite.
The closeout matrix must include at least:

```bash
pnpm test:affected --include-smoke
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Also run the complete owning server files for commands, backups, route
protection, generation chat, prompt assembly, memory jobs/repository/worker/
events, and every new BardWiki server suite. Run the owning frontend settings,
workspace/store, command/resource, memory-job, route, and language suites.

Run `pnpm test:all` only if the final changed surface or repository policy calls
for full pre-merge proof; do not record it as passing unless it actually runs.

## Documentation Exit Criteria

- Architecture guides describe shipped behavior, not planned behavior.
- Route/resource/event, schema/backup, worker, confirmation, prompt, UI, and
  lifecycle ownership are discoverable from `STRUCTURE.md` routing.
- User-visible update policy and provider-cost implications are explained in UI
  help text.
- Import/export and rebuild warnings accurately describe destructive or costly
  behavior.
- `latest-verification.md` distinguishes automated proof, browser proof,
  measured observations, and residual caveats.

## Workstream Exit Criteria

- Every required behavior has passing automated proof or an explicit accepted
  residual gap in `status.md` and `latest-verification.md`.
- No Phase 0-6 invariant is silently weakened.
- TypeScript and required formatting checks pass.
- Browser smoke covers the critical visible workflow.
- No temporary debug logging, unsafe feature bypass, or unbounded model/import
  path remains.
- `status.md` marks all phases complete and records the archive destination.
- The full plan directory is moved to `.archived-docs/` and the active-plan
  index is updated.

## Risks

- A large closeout command can obscure which domain failed. Preserve focused
  phase tests and run them before aggregate lanes.
- Browser smoke proves integration, not every conflict/recovery edge; keep those
  deterministic at repository/route/store level.
- Documentation can accidentally describe intended semantic retrieval or live
  vault sync as shipped. Keep deferred work explicit.
