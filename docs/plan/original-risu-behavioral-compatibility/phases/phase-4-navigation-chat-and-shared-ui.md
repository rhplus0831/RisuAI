# Phase 4 — Navigation, Chat, Shared UI, And Presentation

Status: Pending  
Depends on: Phases 1-3

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
