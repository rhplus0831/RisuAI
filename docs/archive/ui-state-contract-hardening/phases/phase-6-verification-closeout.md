# Phase 6: Verification Closeout

Status: complete.

Goal: prove the complete UI-state contract hardening workstream and archive it
only after all required phases are done.

## Scope

- Re-run focused tests for every changed surface.
- Run broader client/server checks according to touched code.
- Run browser smoke after Phase 5.
- Re-run the Phase 5 coverage-map command/profile.
- Run `pnpm check` and record any pre-existing baseline honestly.
- Record command outcomes in `latest-verification.md`.
- Move this workstream to `docs/archive/` only after closeout proof is green.

## Anchors

- `latest-verification.md`
- `status.md`
- `docs/archive/README.md`
- `STRUCTURE.md`
- TypeScript workflow from `AGENTS.md`

## Target Shape

- Phase statuses are all complete.
- `latest-verification.md` contains a dated closeout proof.
- `docs/archive/README.md` gains a workstream row and `STRUCTURE.md` no longer
  implies this active plan is open.

## Invariants

- Run `pnpm exec tsc -p tsconfig.client-lib.json` before the strict Fastify
  server check.
- Do not replace a failed broad command with narrower proof.
- Do not archive until required validation passes or residual gaps are
  explicitly documented and accepted.
- Use the actual Phase 3 DOM-test filename if it differs from
  `src/App.routeEffect.dom.test.ts`.

## Slices

- Final validation matrix, complete:
  [`slices/phase-6-verification-closeout/final-validation-matrix.md`](slices/phase-6-verification-closeout/final-validation-matrix.md).
- Archive closeout, complete:
  [`slices/phase-6-verification-closeout/archive-closeout.md`](slices/phase-6-verification-closeout/archive-closeout.md).

## Validation

```bash
pnpm exec vitest run src/App.routeEffect.test.ts src/App.routeEffect.dom.test.ts
pnpm exec vitest run \
  src/lib/SideBars/SideChatList.svelte.test.ts \
  src/lib/Others/ChatList.svelte.test.ts \
  src/lib/SideBars/chatGenerationSettingsControls.test.ts \
  src/lib/Setting/pickerGenerationSettings.test.ts \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts
pnpm test
pnpm api:test
pnpm smoke:fastify-browser
pnpm coverage:ui-map
pnpm check
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```
