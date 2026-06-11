# UI State Contract Hardening Status

Date: 2026-06-11

## Snapshot

- Plan state: active.
- Phase 0 is complete: current package scripts and current docs now use
  `pnpm build:site`, including `smoke:fastify-browser`.
- Phase 1 is complete: the visible-state docs policy and structure-doc pointers
  are landed, and docs-only validation passed on 2026-06-11.
- Phase 2 is complete: selector hardening landed for chat lists, generation
  settings controls/pickers, composer/message rows, module/grid catalog, and
  sidebar tabs. Focused selector Vitest proof passed on 2026-06-11; broad
  `pnpm check` still fails on the pre-existing baseline recorded in
  [`latest-verification.md`](latest-verification.md).
- Phase 3 is complete: the mounted sidebar route/refreeze DOM regression test
  landed and focused App route plus sidebar/router baseline Vitest proof passed
  on 2026-06-11.
- Phase 4 is complete: composed generation-settings UI workflow tests now cover
  sidebar-to-picker readiness, incomplete-chat remediation/send guarding,
  missing-reference readiness, mounted projection updates, and visible rollback.
  Focused client and Fastify command/import proof passed on 2026-06-11.
- Phase 5 is complete: Fastify browser smoke passes with visible assertions, and
  the opt-in UI coverage map passes with text, JSON summary, and HTML reports
  under ignored local `coverage/ui-map` artifacts. No coverage thresholds are
  claimed.
- Phase 6 final validation was executed on 2026-06-11 by the
  final-validation-matrix slice, but the matrix is not green. Focused App/UI
  Vitest proof, browser smoke, coverage map, the client-lib TypeScript build,
  and `git diff --check` passed; broad `pnpm test`, `pnpm api:test`,
  `pnpm check`, and strict Fastify server TypeScript failed. Archive remains
  pending.
- A ten-sub-agent audit completed on 2026-06-11 and found the plan valid after
  corrections for slice dependencies, Phase 5 coverage output, Phase 6 closeout
  validation, and Phase 3 sidebar selectors. See [`audit.md`](audit.md).
- Phase 6 closeout is not ready for archive. The failed broad validation rows
  are recorded in [`latest-verification.md`](latest-verification.md) and need
  fixes or explicit residual acceptance before archive closeout.
- No new fix-completeness gate is scheduled. The archived v1/v2/v3 gates remain
  archive-owned, and this plan should not parse archived finding IDs.
- The archived UI-state pilot and chat-scoped generation-settings workstream
  are source material only.

## Phase Router

- [Phase 0](phases/phase-0-command-baseline.md): complete. Build/smoke command
  spelling repaired in current scripts and current docs.
- [Phase 1](phases/phase-1-current-doc-policy.md): complete. Visible-state test
  policy and structure-doc pointers landed, with docs-only proof recorded.
- [Phase 2](phases/phase-2-selector-hardening.md): complete. Stable selectors
  were added to fragile UI surfaces and nearby tests were migrated away from
  structure/style-sensitive queries through six surface/proof slices.
- [Phase 3](phases/phase-3-sidebar-route-refreeze-dom.md): complete. Backfilled
  the sidebar tab route/refreeze regression with a mounted DOM contract and kept
  the existing source-shape guard.
- [Phase 4](phases/phase-4-composed-generation-settings-ui.md): complete. Added
  composed generation-settings UI workflow tests without reopening the archived
  generation-settings workstream.
- [Phase 5](phases/phase-5-browser-smoke-and-coverage-map.md): complete. Added
  thin visible assertions to Fastify browser smoke and an opt-in coverage-map
  command/profile with text, JSON summary, and HTML reporters.
- [Phase 6](phases/phase-6-verification-closeout.md): validation attempted, not
  green. Final validation results are recorded; archive closeout remains pending
  because broad client tests, API tests, `pnpm check`, and strict Fastify server
  TypeScript failed.

## Next Steps

1. Triage the non-green Phase 6 validation rows recorded in
   [`latest-verification.md`](latest-verification.md).
2. Re-run the Phase 6 final-validation matrix after fixes or explicit residual
   acceptance.
3. Keep archive movement pending until closeout proof is green or accepted with
   documented residual gaps.
