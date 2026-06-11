# UI State Contract Hardening Audit

Date: 2026-06-11

Status: archived; completed read-only audit.

Post-implementation note: this audit captured the pre-implementation baseline.
Phases 1 and 2 are now complete; prefer [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md) for current phase state and
proof.

## Method

This audit consolidated ten sub-agent passes plus supervisor-local inspection of
the active plan, current structure docs, archived v2 slice structure, package
scripts, Svelte components, Vitest tests, Playwright smoke, and Fastify
verification workflow.

The archived v2 workstream is used only as a structural reference. Its
fix-completeness gates, finding IDs, and active-risk registry do not apply here.

## Verdict

The plan is valid and should proceed. Its central premise is confirmed: the repo
already has strong state/helper/server coverage, but several user-visible UI
contracts are still either protected by brittle selectors, source-shape checks,
or lower-layer tests that imply rather than prove rendered behavior.

The plan needed these corrections before implementation agents pick it up:

- Replace phase-level serial/parallel ambiguity with dependency-aware slices.
- Add `src/lib/SideBars/Sidebar.svelte` selectors before the Phase 3 DOM test.
- Treat Phase 2 as several surface slices, not one broad selector sweep.
- Frame Phase 4 as visible UI-state coverage only, not feature expansion of the
  archived chat-scoped generation-settings workstream.
- Add `src/ts/chatGenerationSettings.test.ts` to Phase 4 preserved coverage.
- Make Phase 5 coverage output match its target: text, JSON summary, and HTML.
- Add a dedicated coverage-map command/profile and decide how to avoid leaving
  untracked `coverage/ui-map` artifacts.
- Add the Phase 5 coverage command and `pnpm check` to Phase 6 closeout.
- Record a reason when a feasibility-dependent Phase 4 assertion is skipped.

## Validated Claims

- Phase 0 is complete: `smoke:fastify-browser` invokes `pnpm build:site`, and
  current docs use `build:site`.
- Phase 1 is still needed: current structure docs do not yet contain the visible
  state test contract.
- Phase 2 is real work: current tests still rely on text searches,
  `bg-selected`, CSS classes, and action-button order.
- Phase 3 is real work: `src/App.routeEffect.test.ts` only verifies source
  shape; no mounted DOM regression test exists yet.
- Phase 4 is real work: lower layers are well covered, but the visible
  sidebar-to-picker-to-ready workflow is not composed in one DOM proof.
- Phase 5 is real work: Fastify browser smoke mostly asserts hooks, projection
  snapshots, command/API state, and reroll data, not the rendered app.

## Unexpected Work

- Base GUI components do not broadly forward arbitrary `data-*` or ARIA props,
  so most selector work should add stable attributes to wrappers instead of
  refactoring shared primitives.
- `Sidebar.svelte` needs tab and panel selectors for Phase 3. The plan
  originally listed chat-list and generation-control surfaces but not the
  sidebar tabs that Phase 3 must click and assert.
- `src/App.routeEffect.dom.test.ts` does not exist. Phase 3 must add it and
  make its router mock synchronously read `DBState.db`, otherwise the pre-fix
  tracked dependency will not be reproduced.
- Mounted `App.svelte` tests must handle legal/setup gating and always-rendered
  overlays with local marker stubs.
- Phase 3 should assert `character.chatPage`, the chat id at that index,
  `selectedCharID`, `botMakerMode`, and `window.location.pathname`; there is no
  separate selected-chat store.
- `pnpm check` currently has a pre-existing failure baseline. It is still useful
  in closeout, but phase proof must record the existing baseline honestly unless
  a slice fixes it.
- Phase 4 should cover generation-settings save rollback or explicitly document
  why lower-layer rollback coverage plus visible success coverage is sufficient.
- Projection updates carrying `generationSettings` should be tested while
  controls are mounted if feasible; if not, record the reason.
- Phase 5's proposed coverage command currently lacks include filters and
  `html`, so it is not yet the coverage map the phase describes.
- `.prettierignore` ignores `coverage`, but `.gitignore` does not. The coverage
  slice should either add `coverage/` to `.gitignore` or require cleanup after
  local map generation.

## Slice Map

- Phase 0:
  [`command-baseline-proof.md`](phases/slices/phase-0-command-baseline/command-baseline-proof.md).
- Phase 1:
  [`current-testing-policy.md`](phases/slices/phase-1-current-doc-policy/current-testing-policy.md),
  [`structure-doc-pointers.md`](phases/slices/phase-1-current-doc-policy/structure-doc-pointers.md),
  [`phase-1-verification-refresh.md`](phases/slices/phase-1-current-doc-policy/phase-1-verification-refresh.md).
- Phase 2:
  [`chat-list-selectors.md`](phases/slices/phase-2-selector-hardening/chat-list-selectors.md),
  [`generation-settings-selectors.md`](phases/slices/phase-2-selector-hardening/generation-settings-selectors.md),
  [`composer-message-selectors.md`](phases/slices/phase-2-selector-hardening/composer-message-selectors.md),
  [`module-grid-selectors.md`](phases/slices/phase-2-selector-hardening/module-grid-selectors.md),
  [`sidebar-tab-selectors.md`](phases/slices/phase-2-selector-hardening/sidebar-tab-selectors.md),
  [`phase-2-verification-refresh.md`](phases/slices/phase-2-selector-hardening/phase-2-verification-refresh.md).
- Phase 3:
  [`route-refreeze-mounted-dom-test.md`](phases/slices/phase-3-sidebar-route-refreeze-dom/route-refreeze-mounted-dom-test.md),
  [`phase-3-verification-refresh.md`](phases/slices/phase-3-sidebar-route-refreeze-dom/phase-3-verification-refresh.md).
- Phase 4:
  [`composed-sidebar-picker-ready.md`](phases/slices/phase-4-composed-generation-settings-ui/composed-sidebar-picker-ready.md),
  [`incomplete-remediation-send-guard.md`](phases/slices/phase-4-composed-generation-settings-ui/incomplete-remediation-send-guard.md),
  [`delete-invalidation-readiness.md`](phases/slices/phase-4-composed-generation-settings-ui/delete-invalidation-readiness.md),
  [`mounted-projection-update.md`](phases/slices/phase-4-composed-generation-settings-ui/mounted-projection-update.md),
  [`generation-settings-rollback.md`](phases/slices/phase-4-composed-generation-settings-ui/generation-settings-rollback.md),
  [`phase-4-verification-refresh.md`](phases/slices/phase-4-composed-generation-settings-ui/phase-4-verification-refresh.md).
- Phase 5:
  [`fastify-smoke-visible-assertions.md`](phases/slices/phase-5-browser-smoke-and-coverage-map/fastify-smoke-visible-assertions.md),
  [`coverage-map-profile.md`](phases/slices/phase-5-browser-smoke-and-coverage-map/coverage-map-profile.md),
  [`phase-5-verification-refresh.md`](phases/slices/phase-5-browser-smoke-and-coverage-map/phase-5-verification-refresh.md).
- Phase 6:
  [`final-validation-matrix.md`](phases/slices/phase-6-verification-closeout/final-validation-matrix.md),
  [`archive-closeout.md`](phases/slices/phase-6-verification-closeout/archive-closeout.md).

## Current Proof Notes

Sub-agents reported focused green runs for existing coverage, including
chat-list DOM suites, generation-settings helper/control/picker suites, selected
router/sidebar baselines, and focused Fastify import/command suites. These are
audit inputs, not closeout proof for future edits.

One agent verified the current coverage command shape against `/tmp` rather than
repo-local `coverage/ui-map`; Phase 5 still owns adding the actual profile or
script and repo-local artifact policy.
