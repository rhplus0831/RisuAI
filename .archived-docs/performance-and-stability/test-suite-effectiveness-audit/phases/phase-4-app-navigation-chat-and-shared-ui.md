# Phase 4: App Navigation, Chat, And Shared UI

Status: Complete on 2026-08-29; Phases 0-3 satisfied.

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

- [`app-navigation-and-chat.md`](../../../../docs/tests/app-navigation-and-chat.md)
- [`shared-ui-feedback-and-accessibility.md`](../../../../docs/tests/shared-ui-feedback-and-accessibility.md)

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

## Completed Audit Record

The phase opened with 113 category-D owners and 1,235 cases: 108 frontend
owners with 1,116 cases, three Fastify owners with 106 cases, and two browser
owners with 13 cases. All opening cases passed before remediation.

Product-risk review moved nine owners out of category D and moved
`src/lang/index.test.ts` into D. The obsolete two-case
`MobileControls.svelte.test.ts` owner and its orphaned state helper were removed
only after mounted App, Sidebar, live `MobileCharacters`, and compiled responsive
browser replacements were identified. A one-case shared Button owner was added.
After strengthening, the live reviewed set is 114 files and 1,261 cases: 109
frontend owners with 1,142 cases, three reclassified Fastify owners with 106
cases, and two browser owners with 13 cases. The live repository remains at 699
test/spec files and now collects 10,043 cases.

### Contract And Disposition Map

Every file-level contract and disposition is recorded in `inventory.json`.
This grouped map describes why the evidence layers remain distinct.

| Owner family | Live files / cases | Protected contract | Disposition |
| --- | ---: | --- | --- |
| Pure route, history, global API, chat graph, unread, scroll, and GUI helpers | 30 / 155 | Stable route/message identity, valid indices, unread state, focus/input, viewport, highlighting, media cleanup, and localization | 24 Keep / 6 Reclassify |
| Mounted App, ChatScreens, SideBars, Others, and shared UI controls | 79 / 987 | Visible navigation, transcript hydration/editing, composer state, dialogs, feedback, accessibility, and responsive interaction | 77 Keep / 2 Reclassify |
| Fastify provider/model owners formerly classified as shared UI | 3 / 106 | Dispatch options and free-model selection | Reclassify to G |
| Compiled browser route and first-open owners | 2 / 13 | Real history, emitted assets, requests, focus, responsive controls, and final visible state | Keep |

The 105 current category-D owners account for 982 cases and 62 parameterized
rows. Nine live owners with 279 cases remain in this completed review record but
now route to A, B, F, G, K, or L. Together with the incoming localization owner,
the existing observer reclassification, and the removed mobile owner, the phase
records 103 new Keep decisions, ten new Reclassify decisions, and one durable
Remove decision. The previously reviewed observer file remains Reclassify, so
the live inventory totals are 206 Keep, 11 Reclassify, and 482 Pending.

### Behavior And Evidence Layers

| Layer | Distinct failure mode retained |
| --- | --- |
| Pure state and planners | URL serialization, current-owner resolution, chat graph repair, ranges, drafts, unread, and UI policy fail without component noise. |
| Mounted DOM and Svelte | Focus, native semantics, rendered feedback, stable clicked targets, composer/transcript state, and cleanup fail at the actual shared component boundary. |
| Static AST policy | Nine icon actions must retain a native interactive ancestor and an accessible-name source without depending on raw formatting. |
| Fastify integration | Provider dispatch options and model selection remain covered, but under provider/model ownership rather than shared UI. |
| Compiled Chromium | Route transitions, first-open emitted chunks, request ownership, responsive controls, modal focus, and visible recovery fail across the production build. |

The UI coverage map remains a bounded six-owner sentinel. Its manifest and
thresholds are mechanically aligned and pass, but the phase does not claim that
it covers App, Mobile, language, all GUI runtime, or every shared UI component.
Those broader coverage-map and complete-screen accessibility additions remain
explicit residual work rather than inferred protection.

### Findings And Remediation

- `TSA-P04-001` fences overlapping ranged transcript hydration so an older
  response cannot overwrite a newer overlapping range while disjoint placeholder
  fills remain valid.
- `TSA-P04-002` invalidates raw translation after an original-layer partial edit;
  `TSA-P04-003` restores the final successful branch URL when a later optimistic
  fork fails.
- `TSA-P04-004` binds lazy first-open request accounting to each transition;
  `TSA-P04-005` proves hotkey resource guards compose through the installed
  document listener.
- `TSA-P04-006` rejects negative, oversized, fractional, `NaN`, and infinite
  global chat indices; `TSA-P04-007` highlights every intersecting text node.
- `TSA-P04-008` stops removed active media; `TSA-P04-009` makes bookmark
  navigation settle only after its queued route completes.
- `TSA-P04-010` prevents shared Button actions from submitting ancestor forms;
  `TSA-P04-011` tears down seasonal title intervals; `TSA-P04-012` normalizes
  persisted attachment extensions.
- `TSA-P04-013` marks unseen generated replies unread independently of
  auto-scroll; `TSA-P04-014` adds the missing idle saving-feedback owner.
- `TSA-P04-015` replaces raw source-string icon checks with a modern Svelte AST
  oracle; `TSA-P04-016` preserves the complete removal proof for the obsolete
  mobile shell; `TSA-P04-017` records all product-risk category corrections;
  `TSA-P04-018` prevents regenerated inventories from retaining audit metadata
  for deleted tests.
- `TSA-P04-019` defers real visible send/attach/stream/abort/reload, true
  mobile/touch and Firefox/WebKit, stacked-alert/onboarding/full-screen
  accessibility, and broader UI-map work to Phase 13, with a mandatory Phase 14
  revisit. Existing owners remain because their current claims are distinct.

All demonstrated Critical/High defects are fixed. The deferred browser and
coverage additions bound fidelity claims; they are not removal evidence for the
current pure, DOM, or Chromium owners.

### Validation Summary

The exact live Phase 4 frontend set passed 1,142/1,142 across 109 owners in
27.31s, and the three reclassified Fastify owners passed 106/106 in 2.12s.
The complete browser, frontend, UI-map, type/diagnostic, affected-selection,
inventory, formatting, and diff gates are recorded in
`latest-verification.md`. Full historical compatibility remains blocked only by
the absent exact pinned worktree; no substitute checkout or golden was used.
