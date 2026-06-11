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
- A ten-sub-agent audit completed on 2026-06-11 and found the plan valid after
  corrections for slice dependencies, Phase 5 coverage output, Phase 6 closeout
  validation, and Phase 3 sidebar selectors. See [`audit.md`](audit.md).
- Phases 3-6 are planned. Execute them by dependency-aware slices, with focused
  verification before moving to dependent slices. Independent slices with
  disjoint write scopes may run in parallel.
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
- [Phase 3](phases/phase-3-sidebar-route-refreeze-dom.md): planned next.
  Backfill the sidebar tab route/refreeze regression with a real mounted DOM
  contract now that the Phase 2 sidebar-tab selector slice has landed.
- [Phase 4](phases/phase-4-composed-generation-settings-ui.md): planned. Add a
  small set of composed generation-settings UI workflow tests without reopening
  the archived generation-settings workstream.
- [Phase 5](phases/phase-5-browser-smoke-and-coverage-map.md): planned. Add thin
  visible assertions to Fastify browser smoke and add an opt-in coverage-map
  command/profile with text, JSON summary, and HTML reporters.
- [Phase 6](phases/phase-6-verification-closeout.md): planned. Run focused and
  broad proof, including the Phase 5 coverage-map command and `pnpm check`,
  record results, and archive this workstream only after all required phases are
  done.

## Next Steps

1. Assign Phase 3:
   [`phase-3-sidebar-route-refreeze-dom.md`](phases/phase-3-sidebar-route-refreeze-dom.md).
2. Keep write scopes disjoint when multiple agents work in parallel.
3. Update this status file and [`latest-verification.md`](latest-verification.md)
   after each phase lands.
