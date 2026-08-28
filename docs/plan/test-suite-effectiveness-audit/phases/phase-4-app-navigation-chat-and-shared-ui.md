# Phase 4: App Navigation, Chat, And Shared UI

Status: Pending; depends on Phases 0-3.

## Objective

Audit whether navigation, chat, and shared UI tests prove observable behavior,
stable target ownership, responsive interaction, feedback, focus, and
accessibility rather than markup or implementation shape alone.

## Scope

- App shell, routes, history, hotkeys, direct links, sidebar state, folders,
  bookmarks, and character/chat selection.
- Chat transcript hydration, pagination, composer drafts, send progress,
  message rendering/editing/translation, reroll navigation, and visible
  generation layers.
- Desktop/mobile navigation and responsive/Lite behavior.
- Alerts, dialogs, backdrop dismissal, focus traps, generic controls,
  onboarding, feedback, themes, localization, and accessibility policy.
- UI audit probes and mapped coverage sentinels whose primary behavior belongs
  to these surfaces.

Primary discovery guides:

- [`app-navigation-and-chat.md`](../../../tests/app-navigation-and-chat.md)
- [`shared-ui-feedback-and-accessibility.md`](../../../tests/shared-ui-feedback-and-accessibility.md)

## Audit Questions

- Do mounted tests assert visible state, accessible names, focus, and interaction
  outcomes rather than CSS/source substrings?
- Are stale route, character, chat, message, and async-operation targets fenced
  with stable identity?
- Are Happy-DOM assumptions sufficient, or does the behavior require Chromium,
  responsive layout, reload, or real history/navigation?
- Do narrow component tests compose into meaningful chat journeys?
- Are repeated focus/Escape/latest-operation matrices candidates for shared
  helpers without erasing surface-specific behavior?

## Required Outputs

- UI behavior/disposition map from pure routing through DOM and browser proof.
- Accessibility and focus contract inventory, including intentional static
  policy gates.
- Findings for structure-sensitive selectors, internal-only assertions,
  missing composition, stale async ownership, order-coupled fixtures, and weak
  mobile/browser evidence.
- Replacement visible proof before removing any source-shape or narrow UI test
  that currently owns a unique policy.

## Exit Criteria

- Every Phase 4 test has a disposition and a named user-visible or policy
  contract.
- Unique route, transcript, composer, responsive, focus, feedback, and
  accessibility behavior remains protected.
- Mapped UI coverage owners remain aligned with `coverage:ui-map`.
- Critical/High visible-state findings are fixed or explicitly routed.
- Count deltas and missing end-to-end journeys are recorded.

## Validation

- Focused Node/Svelte+Node/DOM owners
- `pnpm test:affected --dry-run` and selected lanes
- `pnpm test:frontend:all`
- `pnpm coverage:ui-map`
- Relevant Playwright specs and screenshot review
- `pnpm test:smoke` before phase closeout when browser owners change
- `pnpm check`
- `pnpm format:check`
- `git diff --check`
