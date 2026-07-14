# Slice: Phase 3 Verification Refresh

Phase: [3](../../phase-3-sidebar-route-refreeze-dom.md). No runtime change.

Status: complete. Depended on
[`route-refreeze-mounted-dom-test.md`](route-refreeze-mounted-dom-test.md).

## Scope

Refresh Phase 3 proof and update plan navigation after the mounted DOM backfill
lands.

## Anchors

- `docs/plan/ui-state-contract-hardening/status.md`
- `docs/plan/ui-state-contract-hardening/latest-verification.md`
- `src/App.routeEffect.test.ts`
- `src/App.routeEffect.dom.test.ts`

## Target Shape

- `latest-verification.md` records the focused App route tests and sidebar/router
  baseline.
- `status.md` marks Phase 3 complete only after the DOM proof passes.
- If the DOM test filename differs, all validation commands and status text use
  the actual path.

## Invariants

- Record `pnpm check` with any pre-existing baseline honestly if it is run.
- Do not treat the source-shape guard alone as Phase 3 proof.

## Done Criteria

- Phase 3 status and verification are current.
- Focused tests pass.

## Validation

```bash
pnpm exec vitest run src/App.routeEffect.test.ts src/App.routeEffect.dom.test.ts
pnpm exec vitest run src/lib/SideBars/SideChatList.svelte.test.ts src/ts/router.test.ts
git diff --check
```
