# UI State Contract Hardening Status

Date: 2026-06-11

## Snapshot

- Plan state: active.
- Phase 0 is complete: current package scripts and current docs now use
  `pnpm build:site`, including `smoke:fastify-browser`.
- Phases 1-6 are planned and should be executed one phase at a time by
  implementation agents with focused verification before moving on.
- No new fix-completeness gate is scheduled. The archived v1/v2/v3 gates remain
  archive-owned, and this plan should not parse archived finding IDs.
- The archived UI-state pilot and chat-scoped generation-settings workstream
  are source material only.

## Phase Router

- [Phase 0](phases/phase-0-command-baseline.md): complete. Build/smoke command
  spelling repaired in current scripts and current docs.
- [Phase 1](phases/phase-1-current-doc-policy.md): planned. Promote the visible
  state contract into current structure docs.
- [Phase 2](phases/phase-2-selector-hardening.md): planned. Add stable
  selectors to fragile UI surfaces and migrate nearby tests away from
  structure/style-sensitive queries.
- [Phase 3](phases/phase-3-sidebar-route-refreeze-dom.md): planned. Backfill the
  sidebar tab route/refreeze regression with a real mounted DOM contract.
- [Phase 4](phases/phase-4-composed-generation-settings-ui.md): planned. Add a
  small set of composed generation-settings UI workflow tests.
- [Phase 5](phases/phase-5-browser-smoke-and-coverage-map.md): planned. Add thin
  visible assertions to Fastify browser smoke and add an opt-in coverage-map
  command/profile.
- [Phase 6](phases/phase-6-verification-closeout.md): planned. Run focused and
  broad proof, record results, and archive this workstream only after all
  required phases are done.

## Next Steps

1. Assign Phase 1 to an implementation agent.
2. Keep write scopes disjoint when multiple agents work in parallel.
3. Update this status file and [`latest-verification.md`](latest-verification.md)
   after each phase lands.
