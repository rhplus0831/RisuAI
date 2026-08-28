# Phase 4 Slice: Toggle Preset Planning

Status: Complete

## Scope

Extract Saved Toggles comparison, similarity ranking, Pick eligibility/value
projection, and active-chat value projection from the browser-shaped
`chatGenerationTogglePresets.ts` entry graph into a plain TypeScript leaf. Move
the pure domain suite to Node and retain mounted sidebar/dialog contracts for
visible state, interaction, persistence, and rollback.

This is the selected settings projection slice. It preserves preset ordering,
default values, mismatch precedence, key/kind eligibility, persistence
semantics, and all user-visible behavior.

## Source And Capability Boundaries

- Previous D owner: `src/ts/chatGenerationTogglePresets.test.ts`. Its five pure
  cases needed mocks for module and script graphs because the subject imported
  Svelte resource state, settings commands, chat commands, and UUID/runtime
  helpers.
- New N leaf: `src/ts/chatGenerationTogglePresetPlanning.ts`. Its runtime has no
  Svelte, DOM, resource, persistence, command, or browser imports.
- Production callers: `chatGenerationTogglePresets.ts`, `Toggles.svelte`,
  `ChatGenerationTogglePresets.svelte`, and
  `ChatGenerationTogglePresetDialog.svelte` consume the leaf directly or
  through the compatibility exports.
- Retained D owner: `chatGenerationSettingsControls.test.ts` continues to mount
  the composed sidebar and dialog against active-chat resource state.

The Node matrix keeps the original five similarity, deterministic tie-break,
Pick eligibility, and legacy-normalization cases and adds comparison plus
active-key/default projection cases. It therefore moves one file and expands
the pure matrix from five to seven tests without removing a DOM-visible oracle.

## Retained DOM Contracts And Deferrals

The 40-test sidebar owner still proves Saved Toggles label precedence, missing
and mismatched associations, localized captions, selection without value
application, deletion behavior, overwrite confirmation, Pick ineligibility,
exact chosen values, namespaced Agent sources, active-chat persistence, pending
status, and failed-save rollback.

The three Phase 3-ranked mounted files remain D-owned after fresh inspection:

- `TranslatorPresetSettings.svelte.test.ts` spends 2.36s in test bodies, but
  its projection cases cross resource-apply epochs, local-effect receipts,
  pending durable writes, lifecycle flushes, and rollback. Extracting its small
  record helpers would leave the same component import graph and would not move
  those behavioral contracts. Revisit when a measured persistence controller
  or reducer can move multiple cases without weakening receipt/rollback proof.
- `pickerGenerationSettings.test.ts` remains focused on modal focus ownership,
  archive/rename/reorder interactions, active-chat versus global selection,
  pending status, and rollback. Revisit only when a current profile identifies
  a repeated pure selection planner independent of those DOM contracts.
- `chatGenerationSettingsControls.test.ts` is the retained integration owner
  for this leaf. Its immediate focused test-body observation was unchanged
  within noise, so no further extraction from the mounted suite is justified in
  this slice.

## Measurements

Before extraction, the pure five-test suite passed in Happy-DOM with 2.86s
Vitest duration, 2.60s import, 5ms test bodies, 109ms environment, 3.59s wall,
and 664,596 KiB peak RSS. The seven-test Node owner passes in 169ms Vitest
duration with 12ms import, 6ms test bodies, and no environment time.

The retained sidebar owner passed before the slice in 12.66s Vitest duration,
with 10.40s import and 1.99s test bodies. After the slice it passed in 12.45s,
with 10.22s import and 1.96s test bodies. This is unchanged within noise, as
expected for the retained mounted contract.

Complete project and ordinary-frontend results are recorded in
[`../../../latest-verification.md`](../../../latest-verification.md). Node
passed 190 files / 1,272 tests in 4.39s Vitest duration and 5.11s wall;
Happy-DOM passed 323 files / 4,981 tests in 60.52s and 61.35s. The ordinary
frontend passed 530 files / 6,420 tests in 69.97s and 70.83s, with 4,680,480 KiB
peak RSS. The focused environment/import removal is the performance mechanism;
the ordinary observation is near the Phase 3 warm range and is not a
phase-level claim.

## Validation

- New Node owner: 1 file / 7 tests passed.
- Retained composed sidebar: 1 file / 40 tests passed.
- Active-chat generation settings companion: 1 file / 19 tests passed.
- Complete Node, Happy-DOM, and ordinary frontend runs passed.
- Affected routing selected frontend, performance, and server lanes; execution
  passed 536 frontend files / 6,623 tests, 2 performance files / 6 tests, and
  154 server files / 3,295 tests with 1 skip.
- `pnpm check` passed with zero errors and warnings.
- Inventory regeneration and exhaustive/disjoint verification passed.
- Formatting and `git diff --check` passed.

## Rollback

Move the planning functions and types back into
`chatGenerationTogglePresets.ts`, restore the test's browser-graph mocks and D
ownership, and point the three component imports back to the broad entry. No
data or protocol migration is involved.
