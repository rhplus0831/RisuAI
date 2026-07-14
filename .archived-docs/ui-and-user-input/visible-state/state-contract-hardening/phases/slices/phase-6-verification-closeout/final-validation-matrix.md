# Slice: Final Validation Matrix

Phase: [6](../../phase-6-verification-closeout.md). No runtime change.

Status: complete. Depended on all required implementation and proof-refresh slices.

## Scope

Run the closeout validation matrix and record exact command results.

This slice does not archive the workstream; archive movement is the next slice.

## Anchors

- `docs/plan/ui-state-contract-hardening/latest-verification.md`
- `docs/plan/ui-state-contract-hardening/status.md`
- `AGENTS.md`
- `docs/structure/testing-and-operations.md`

## Target Shape

- Focused UI-state suites pass.
- `pnpm test`, `pnpm api:test`, `pnpm smoke:fastify-browser`,
  `pnpm coverage:ui-map`, `pnpm check`, both TypeScript checks, and
  `git diff --check` are run.
- Any pre-existing `pnpm check` baseline is recorded honestly.
- The strict Fastify server check is run only after the client-lib declaration
  build.

## Invariants

- Do not replace a failed broad command with narrower proof.
- Use the actual Phase 3 DOM-test filename if it differs from
  `src/App.routeEffect.dom.test.ts`.
- Do not archive until this proof is green or residual gaps are explicitly
  accepted.

## Done Criteria

- `latest-verification.md` contains a dated closeout proof.
- `status.md` accurately summarizes completed phases and residual caveats.

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
