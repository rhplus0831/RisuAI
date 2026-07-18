# Hypa modal filter state resets on every server summary refresh

## Summary

The Hypa V3 modal computes default filter state (show-important-only, category
filter) in an `$effect` that was meant to run once per open. The Fastify port
added a tracked read of `hypaV3Data.summaries.length` to that effect, and the
server-backed refresh path replaces `serverHypaV3Data` wholesale, so the
`$derived` feeding the effect changes identity on every refresh. Any background
refresh — a delete, a completed summarize job, a failed PATCH's reconcile —
re-runs the effect and overwrites the user's chosen filters with the defaults.

## Location

- `src/lib/Others/HypaV3Modal.svelte:570-587` — the defaults effect; the bare
  tracked read `hypaV3Data.summaries.length` at `:572` re-arms it forever.
- `src/lib/Others/HypaV3Modal.svelte:95` — `hypaV3Data` is
  `$derived(serverBackedMemoryMode ? serverHypaV3Data : legacyHypaV3Data)`.
- `src/lib/Others/HypaV3Modal.svelte:178-182` — `refreshServerSummaries`
  assigns a brand-new `serverHypaV3Data` object on every successful list.
- `src/lib/Others/HypaV3Modal.svelte:360-370,406-412` — SSE memory-job
  completion events trigger `refreshServerSummaries`.
- `src/lib/Others/HypaV3Modal.svelte:326` — deletes splice `summaries`,
  changing `.length` directly.
- Original for comparison: `/home/codex/Risuai/src/lib/Others/HypaV3Modal.svelte:116-132`
  — the pre-migration effect tracked only `$hypaV3ModalOpen` and untracked all
  summary reads.

## Trigger

1. Open the Hypa V3 modal on a chat that has at least one important summary.
   The defaults effect enables "show important only".
2. Turn "show important only" OFF (or pick a specific category filter).
3. Cause any server summary refresh: delete a summary, let a summarize job
   complete in the background (routine after sending a chat message — the same
   modal's jobs panel exists to watch them), or let any summary PATCH fail so
   the reconcile refresh runs.

## Expected behavior

Filter choices persist for the lifetime of the open modal; defaults are
computed once when the modal opens (or once per chat).

## Actual behavior

`filterState.showImportantOnly`, `filterState.selectedCategoryFilter`, and
`categoryManagerState.selectedCategoryFilter` snap back to their defaults.
With important summaries present, the important-only filter re-enables itself
and hides most of the list — to the user it looks like summaries were deleted
mid-session.

## Underlying cause

The tracked `.length` read was presumably added so defaults recompute after the
async initial load, but nothing bounds it to the first load: every wholesale
`serverHypaV3Data` replacement changes the derived's identity and re-fires the
effect even when the length is unchanged, and every delete/job addition
re-fires it via `.length`.

## Affected data flow

1. SSE `memory.job` completed event → `refreshServerSummariesAfterMutations`
   → `refreshServerSummaries`.
2. `serverHypaV3Data = { … }` (new object identity).
3. `hypaV3Data` `$derived` recomputes.
4. Defaults effect at `:570` re-runs and overwrites the three filter fields.
5. The summary list re-renders under the reverted filters.

## Severity and likely user impact

**Medium.** Spontaneous UI-state reversion (the maintainer's symptom class 2)
that hides data mid-session with no error. It fires on the modal's most common
background event — a summarize job finishing.

## Recommended fix

Compute defaults only until the first successful load per chat: set a
`defaultsAppliedForChatId` flag in `refreshServerSummaries`' first `ok` branch
and clear it in the chat-change effect; drop the tracked `.length` read (or
wrap the whole defaults body in `untrack` and key it on modal open + chat id
only).

## Test gap

A component test that opens the modal, flips `showImportantOnly` off, resolves
a second summary-list refresh with identical content, and asserts the filter
state is unchanged.
