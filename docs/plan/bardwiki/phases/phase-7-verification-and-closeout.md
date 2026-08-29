# Phase 7: Verification and Closeout

Status: pending.

Goal: prove the completed BardWiki system across persistence, commands,
generation, prompt assembly, jobs, UI, lifecycle, recovery, security,
performance, and documentation, then close and archive the workstream.

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
