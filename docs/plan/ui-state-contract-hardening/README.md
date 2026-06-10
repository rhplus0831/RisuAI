# UI State Contract Hardening Plan

Date: 2026-06-11

Status: active.

This workstream turns the completed UI-state pilot into current policy and
adds the missing coverage layer for recent state-to-visible-UI regressions. It
uses the archived v2 remediation structure as a reference for phase routing,
slice scope, and proof discipline, but it does not reopen v2 or any archived
chat-scoped generation-settings phase.

Start with [`status.md`](status.md), then read [`plan.md`](plan.md). Phase
scope lives under [`phases/`](phases/), and proof updates live in
[`latest-verification.md`](latest-verification.md).

## Read Order

1. [`status.md`](status.md) - current snapshot and phase router.
2. [`plan.md`](plan.md) - goal, boundary sources, baseline, invariants, phase
   order, and non-goals.
3. [`phases/README.md`](phases/README.md) - phase index and implementation
   rules.
4. [`latest-verification.md`](latest-verification.md) - recorded command proof
   and audit notes.
5. Phase files under [`phases/`](phases/) - concrete implementation scope,
   anchors, done criteria, and validation.

## Sub-Agent Inputs

This plan consolidates five read-only audit passes:

- Documentation and policy promotion.
- Selector hardening and Svelte DOM test fragility.
- Sidebar tab stability after route/projection refreeze.
- Chat-scoped generation settings UI and lifecycle visibility.
- Fastify browser smoke and coverage-map workflow.

## Source Anchors

- Policy precedent:
  [`../../archive/ui-state-contract-tests.md`](../../archive/ui-state-contract-tests.md).
- Reference structure:
  [`../../archive/audit-stability-and-performance-v2/`](../../archive/audit-stability-and-performance-v2/).
- Current testing docs:
  [`../../structure/testing-and-operations.md`](../../structure/testing-and-operations.md),
  [`../../structure/frontend.md`](../../structure/frontend.md),
  [`../../structure/server-projection-and-bridges.md`](../../structure/server-projection-and-bridges.md).
- App route/refreeze surface:
  `src/App.svelte`, `src/App.routeEffect.test.ts`,
  `src/lib/SideBars/Sidebar.svelte`, `src/ts/router.ts`.
- DOM contract surfaces:
  `src/lib/SideBars/SideChatList.svelte`,
  `src/lib/Others/ChatList.svelte`,
  `src/lib/ChatScreens/DefaultChatScreen.svelte`,
  `src/lib/Setting/botpreset.svelte`,
  `src/lib/Setting/listedPersona.svelte`,
  `src/lib/SideBars/Toggles.svelte`,
  `src/lib/SideBars/CustomSidebar.svelte`.
- Browser smoke:
  `server/fastify/browser-smoke/`,
  `playwright.fastify-smoke.config.ts`,
  `src/ts/server/browserSmoke.ts`.

## Current Entry Point

The next implementation batch is Phase 1:
[`phases/phase-1-current-doc-policy.md`](phases/phase-1-current-doc-policy.md).
Phase 0 was completed during plan setup by fixing the current `build:site`
script references.
