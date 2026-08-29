# Phase 4 — Navigation, Chat, Shared UI, And Presentation

Status: Complete
Depends on: Phases 1-3

Completion anchors:

- `e9901b0f68acc405cef8a8af642eb40f83e8affb` — closed route and
  primary-control inventory with semantic production markers.
- `477a3aece1fffc159b0354fef5b21ecddf60cab5` — visible pre-token
  failure and exact billing-aware Retry through the built browser.
- `6487cba00e3cc435a3c4f57f8121663bcdccc57e` — signed responsive-shell
  classification backed by individual maintainer authority.

## Objective

Verify visible navigation and common chat workflows across routes, sidebars,
composer, transcript, shared controls, hotkeys, focus, feedback, and responsive
layouts.

## Audit Questions

- Are retained routes, selections, back/forward transitions, sidebar actions,
  modal flows, and deep links reachable with equivalent outcomes?
- Do send/continue/regenerate/edit/delete/copy actions expose the correct
  enabled, loading, success, error, and retry states?
- Are transcript ordering, role labels, branching/reroll controls, markdown,
  assets, and partial/final content rendered consistently?
- Do keyboard shortcuts, focus restoration, mobile controls, safe areas, and
  responsive layouts preserve action availability?
- Are unsupported controls absent or visibly diagnosed rather than silently
  failing?

## Required Outputs

- Route/action/control inventory cross-linked to durable command ownership.
- Built-browser desktop and narrow-viewport journeys for the primary chat path.
- Focus/hotkey and feedback assertions, including failure/cancel/retry.
- Rendering fixtures for legacy/partial/multi-result content and assets.
- Explicit UI ownership for unsupported/no-port behavior.

## Exit Criteria

- Every retained primary interaction is reachable and produces the verified
  logical outcome with visible feedback.
- Responsive and keyboard paths do not hide required actions or create alternate
  unsafe mutation paths.
- Rendering and transcript controls match baseline semantics or signed decisions.
- Owning UI, browser, state, and compatibility lanes pass.

## Validation

Run component/interaction tests, built-browser desktop/mobile journeys, visual or
DOM assertions where semantics require them, affected and compatibility lanes,
formatting, and `git diff --check`.

## Completion Record

### Routes And Controls

`src/ts/uiCompatibilityInventory.ts` closes every route kind, root segment,
settings slug, playground slug, and stable primary control marker. The catalog
classifies route, character/chat/message command, generation, input-hook,
translation, speech, read-only export, local UI, and deliberately unmounted
owners. Production semantic attributes make control additions fail closed
without providing an alternate test-only mutation path.

The owning route, App, sidebar, composer, reroll, and hotkey lanes passed as an
eight-file 156-test selection. They cover direct links, navigation replacement,
resource loading/error, responsive dialog focus, Escape, keyboard suppression,
composer drafts, transcript paging, reroll controls, and durable command
ownership.

### Visible Chat Lifecycle

The production-bundle `acceptedSendProtocol.spec.ts` matrix passed all eleven
desktop and Pixel journeys against real Fastify routes, SQLite, and SSE. It
proves send, streaming partials, reload/reattach, lost operation response,
transport reconnect, server restart, billing-aware retry, Stop, queued
finalization, and two-chat concurrency without transcript duplication or
display/persistence drift.

The addition at `477a3aece1fffc159b0354fef5b21ecddf60cab5` closes the visible
pre-output failure path: the provider error is shown, the accepted-send recovery
banner remains actionable, Retry asks for paid-side-effect confirmation, the
second provider attempt succeeds, and the original user row is not appended
again. The reroll production journey independently passed and proves candidate
persistence plus swipe recovery after reload.

### Responsive-Shell Decision

The fork-point baseline selected `MobileHeader`, `MobileBody`, and
`MobileFooter` under `betaMobileGUI` at narrow widths. Fastify instead uses the
shared App sidebar/dialog shell. Commit
`2073b5fb6a755516b80e48509c6e0a322f062677`, authored by maintainer RH+, is
explicit authority: it removed tests for those unmounted legacy components and
documented the mounted App plus responsive Chromium journeys as the current
product contract. `ORC-DECISION-060` and `ORC-SURFACE-099` therefore govern a
signed divergence rather than an unresolved comparison.

## Verification Evidence

| Check | Result |
| --- | --- |
| Eight focused route/App/sidebar/composer/reroll/hotkey files | Passed; 8 files and 156 tests. |
| `src/ts/uiCompatibilityInventory.test.ts` after signed classification | Passed; 1 file and 3 fail-closed structural tests. |
| Full `server/fastify/browser-smoke/acceptedSendProtocol.spec.ts` | Passed; 11 production-bundle desktop/Pixel lifecycle journeys. |
| `server/fastify/browser-smoke/rerollSwipePersistence.spec.ts` | Passed; 1 production-bundle reload/swipe journey. |
| `pnpm test:compat-harness` | Passed at `7ba933fe6f1c3338bd9cce2ef308b2b216ac8e8d`; 16 cells, 15 governed divergences, cluster 10 healthy. |
| Register validation and fail-closed register Vitest | Required after the Category D/decision update; exact counts are recorded in `latest-verification.md`. |
| Formatting and `git diff --check` | Required and recorded in `latest-verification.md`. |

Category D rows `ORC-SURFACE-097` through `ORC-SURFACE-099` own the closed
route/control, visible lifecycle, and responsive-shell surfaces. Prompt contents
and provider wire behavior remain explicitly cross-owned by Phases 6 and 7.
