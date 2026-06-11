# UI State Contract Hardening Status

Date: 2026-06-11

## Snapshot

- Plan state: archived complete on 2026-06-11.
- Phase 0 is complete: current package scripts and current docs now use
  `pnpm build:site`, including `smoke:fastify-browser`.
- Phase 1 is complete: the visible-state docs policy and structure-doc pointers
  are landed, and docs-only validation passed on 2026-06-11.
- Phase 2 is complete: selector hardening landed for chat lists, generation
  settings controls/pickers, composer/message rows, module/grid catalog, and
  sidebar tabs. Focused selector Vitest proof passed on 2026-06-11; the earlier
  broad `pnpm check` baseline is preserved in
  [`latest-verification.md`](latest-verification.md), and the final rerun now
  passes.
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
- Phase 6 final validation is complete and green after the repair slices. The
  historical red attempt is preserved in
  [`latest-verification.md`](latest-verification.md), and the 2026-06-11 rerun
  passed focused UI-state proof, broad client/API tests, browser smoke,
  coverage map, `pnpm check`, both TypeScript checks, and the final whitespace
  and status checks.
- A ten-sub-agent audit completed on 2026-06-11 and found the plan valid after
  corrections for slice dependencies, Phase 5 coverage output, Phase 6 closeout
  validation, and Phase 3 sidebar selectors. See [`audit.md`](audit.md).
- Phase 6 archive closeout is complete: the workstream moved from `docs/plan/`
  to `docs/archive/`, archive navigation and `STRUCTURE.md` were updated, and
  archive-slice validation passed.
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
- [Phase 6](phases/phase-6-verification-closeout.md): complete. Final
  validation rerun passed after repairs, and archive closeout completed on
  2026-06-11.

## Closeout

- Archived under `docs/archive/ui-state-contract-hardening/` on 2026-06-11.
- Preserve the historical red Phase 6 attempt and the green rerun proof in
  [`latest-verification.md`](latest-verification.md) for closeout context.
- Residual gaps: none.
