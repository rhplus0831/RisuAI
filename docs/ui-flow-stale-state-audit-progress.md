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
| I-05 | Character/media uploads | Fixed | complete | complete | passed | `b93095edd fix: issue upload tokens before file reads` | Upload tokens now start in picker callbacks; verifier fixed read-rejection cleanup and passed focused race tests. |
| I-06 | Prompt settings | Fixed | complete | complete | passed | `5f02a8d59 fix: preserve dirty prompt settings across projection` | Dirty/owner-aware prompt settings drafts now reassert stale projections before debounce flush; verifier passed focused tests/typecheck. |
| I-07 | Active chat generation settings | Fixed | complete | complete | passed | `f1f998f03 fix: guard chat generation modals by target` | Captured active-chat targets through reset/input/picker flows; verifier passed focused stale-target tests. |
| I-08 | Bundle/local-backup import | Fixed | complete | complete | passed | `019cd24eb fix: stage bundle assets until import commit` | Bundle assets are staged until DB decode/import succeeds; verifier passed route tests and strict server typecheck. |
| I-09 | Lorebook UI | Fixed | complete | complete | passed | `c91ce1d89 fix: resolve lorebook deletes after confirmation` | Delete confirmations now resolve latest row by stable target; verifier passed focused tests and `pnpm check`. |
| I-10 | Module imports | Fixed | complete | complete | passed | `fa0c7a1f4 fix: merge module imports into latest draft` | Module lorebook/regex imports now return rows and merge by stable module id; verifier passed focused tests and `pnpm check`. |
| I-11 | Plugins/custom UI | Fixed | complete | complete | passed | `dc344ff92 fix: guard plugin v3 reload generations` | Plugin loads are coalesced and V3 providers/custom UI reject stale generations; verifier passed focused tests and `pnpm check`. |
| I-12 | Plugin/MCP rollback | Fixed | complete | complete | passed | `fix: make plugin and mcp rollbacks attempted-aware` | Theme and MCP token rollbacks now preserve newer edits; verifier passed focused tests and `pnpm check`. |

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
