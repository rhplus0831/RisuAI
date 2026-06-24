# UI Flow Stale State Audit Progress

Date started: 2026-06-24.

This document tracks remediation of the Confirmed Issues and Risks To Harden in
`docs/ui-flow-stale-state-audit.md`.

## Workflow States

- `Pending`: not started.
- `Exploring`: explorer agent is examining the area.
- `Ready`: explorer findings are available for implementation.
- `Implementing`: implementation worker is applying the fix.
- `Verifying`: verification worker is validating the result.
- `Fixed`: verification passed and the fix was committed.
- `Blocked`: work cannot continue without a decision or external change.

## Confirmed Issues

| ID | Area | Status | Explorer | Implementation | Verification | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| I-01 | Chat send | Fixed | complete | complete | passed | `8e1d112d5 fix: carry chat send target through async flow` | Captured active chat target through append/send; verifier passed focused DOM and sendChat tests. |
| I-02 | Message translation | Fixed | complete | complete | passed | `977737ff2 fix: target message translation updates by id` | Applied/rolled back translation by captured message id; verifier passed focused rendered stale-switch test. |
| I-03 | Projection/SSE | Fixed | complete | complete | passed | `fad8fec93 fix: resync failed projection applies before cursor advance` | Lorebook/chat-message surgical apply failures now await full resync before marking events applied. |
| I-04 | Character editor | Fixed | complete | complete | passed | `fa1f78e4e fix: guard character draft actions by live row` | Replaced draft `type` gates with live selected-row/draft-id guards; verifier passed focused CharConfig and bridge tests. |
| I-05 | Character/media uploads | Fixed | complete | complete | passed | `fix: issue upload tokens before file reads` | Upload tokens now start in picker callbacks; verifier fixed read-rejection cleanup and passed focused race tests. |
| I-06 | Prompt settings | Pending |  |  |  |  | Protect dirty prompt settings against stale projection before debounce flush. |
| I-07 | Active chat generation settings | Pending |  |  |  |  | Capture chat target across confirm/input/modal flows. |
| I-08 | Bundle/local-backup import | Pending |  |  |  |  | Avoid persisting assets when DB import later fails. |
| I-09 | Lorebook UI | Pending |  |  |  |  | Delete latest row by stable id/key after delayed confirmation. |
| I-10 | Module imports | Pending |  |  |  |  | Merge imports into latest target after delayed picker and handle cancel. |
| I-11 | Plugins/custom UI | Pending |  |  |  |  | Generation-guard overlapping plugin V3/custom UI loads. |
| I-12 | Plugin/MCP rollback | Pending |  |  |  |  | Make rollback attempted-value aware. |

## Risks To Harden

| ID | Area | Status | Explorer | Implementation | Verification | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-01 | Generation settings rollback | Pending |  |  |  |  | Failed older save should not restore over newer optimistic values. |
| R-02 | Generation local mirror | Pending |  |  |  |  | Resolve chat by stable id before SSE patch/terminal/post-gen mirror. |
| R-03 | Message icon actions | Pending |  |  |  |  | Capture chat/message target before async icon-action delay. |
| R-04 | Model role apply | Pending |  |  |  |  | Capture selected preset before awaited role update. |
| R-05 | Model profile drawer | Pending |  |  |  |  | Existing-profile edit should not create if projection deletes profile. |
| R-06 | Modal chat delete | Pending |  |  |  |  | Capture originating character id before confirm. |
| R-07 | Sortable chat reorder | Pending |  |  |  |  | Validate DOM chat ids still belong to same character during drag. |
| R-08 | Destructive refresh | Pending |  |  |  |  | Skip optimistic rollback after destructive refresh epoch changes. |
| R-09 | Realm import | Pending |  |  |  |  | Decide and encode freshness-before-resync behavior. |
| R-10 | Avatar upload | Pending |  |  |  |  | Decide whether navigation should cancel avatar upload. |
| R-11 | Dirty merge granularity | Pending |  |  |  |  | Document or refine top-level conflict granularity. |
| R-12 | Script draft reorder | Pending |  |  |  |  | Preserve dirty row fields across stable-id reorder. |
| R-13 | MCP risuaccess | Pending |  |  |  |  | Revalidate targets after deferred access prompt. |
