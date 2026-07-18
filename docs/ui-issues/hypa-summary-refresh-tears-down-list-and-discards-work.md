# Hypa summary refresh tears down the list and discards in-progress work

## Summary

Every server summary refresh in the Hypa V3 modal unconditionally enters the
fullscreen "Loading…" branch and rebuilds a fresh view object for every
non-dirty row. Because the summary list is keyed by object identity, all
mounted `ModalSummaryItem` components are destroyed and re-created on every
background refresh. Component-local state — an in-flight or completed-but-
unapplied reroll, translations, expanded connected messages, a pending
delete confirmation — is silently discarded, and a separate `$effect.pre`
collapses all summaries and closes the search bar.

## Location

- `src/lib/Others/HypaV3Modal.svelte:149` — `refreshServerSummaries` sets
  `serverMemoryLoading = true` on every call, not just the first.
- `src/lib/Others/HypaV3Modal.svelte:1228-1231` — `{#if serverBackedMemoryMode
  && serverMemoryLoading}` replaces the entire summaries list with the loading
  row, unmounting every item.
- `src/lib/Others/HypaV3Modal.svelte:159-170` — the refresh rebuilds
  `serverSummaryView(summary)` objects for every non-dirty row even when
  content is identical.
- `src/lib/Others/HypaV3Modal.svelte:1304` — `{#each hypaV3Data.summaries as
  summary, i (summary)}` is keyed by object identity, so new view objects
  always remount.
- `src/lib/Others/HypaV3Modal.svelte:549-568` — `$effect.pre` tracking
  `hypaV3Data?.summaries?.length` resets `expandedMessageState`, `searchState`,
  and collapses all summaries (`:566`) whenever the data is replaced.
- `src/lib/Others/HypaV3Modal/modal-summary-item.svelte:81-96` — reroll/
  translation results are component-local `$state`.
- `src/lib/Others/HypaV3Modal/modal-summary-item.svelte:103-111` — `onDestroy`
  invalidates all in-flight runs, so late results are dropped.
- `src/lib/Others/HypaV3Modal/modal-summary-item.svelte:113-115` —
  `ownsSummary` requires the captured object to still be in
  `hypaV3Data.summaries`, so a pending "Delete this"/"Delete after"
  double-confirm silently no-ops after the remount replaced the objects.

## Trigger

1. With the modal open, click Reroll on a summary (or open a translation, or
   expand a connected message), and while it is pending —
2. a summarize job for this chat completes in the background (routine after
   sending a message), or any summary PATCH fails (scheduling the reconcile
   refresh), or a delete fails (direct refresh).

## Expected behavior

Background refreshes render over the existing list; unchanged rows keep their
component instances, so in-progress reroll/translation state, expansion,
search, scroll position, and pending confirmations survive; the new summary
appears in place.

## Actual behavior

The whole list swaps to "Loading…", destroying every item, then remounts
fresh: the in-flight reroll result arrives into a destroyed component
(`componentActive = false`) and is dropped; completed-but-unapplied reroll
text and translations vanish; all summaries collapse and search closes; a
delete confirmation the user is answering silently does nothing when
confirmed.

## Underlying cause

`refreshServerSummaries` conflates "first load" with "reconcile refresh" (one
`serverMemoryLoading` flag drives an unmounting branch), and the view-object
rebuild plus object-identity keying prevents Svelte from preserving component
instances across content-identical refreshes.

## Affected data flow

1. Job event / PATCH failure → `refreshServerSummaries`.
2. `serverMemoryLoading = true` → `{#if}` unmounts all `ModalSummaryItem`s.
3. List response → new `serverSummaryView` objects → keyed `{#each}` mounts
   fresh components.
4. The late `summarize()` result fails its `isCurrentReroll`/`ownsSummary`
   fences and is discarded.

## Severity and likely user impact

**Medium.** Silently throws away LLM output the user paid and waited for
(symptom class 2), cancels confirmed destructive actions without feedback, and
destroys list UI state on a routine background event.

## Recommended fix

Show the loading branch only when the list is empty; in
`refreshServerSummaries`, reuse the existing local view object when `serverId`
and content are unchanged (or key the `{#each}` by `serverId` and identify
summaries by id rather than object identity in `ownsSummary` and the delete
paths).

## Test gap

A component test that starts a reroll, resolves a background list refresh with
identical content, then resolves the reroll and asserts the result is applied;
a second test asserting expansion/search state survives a refresh.
