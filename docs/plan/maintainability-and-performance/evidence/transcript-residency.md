# Transcript Residency Decision and Verification

## Repeated baseline and decision

Source `47aa4d7da`; [retained repeated measurements](transcript-remeasurement.json).
The same ten-case matrix, fixture, runtime, profiles and request/timing attribution
from [the original baseline](transcript-baseline.md) ran serially after Phase 4:

```sh
RISU_TRANSCRIPT_COSTS=1 RISU_TRANSCRIPT_REPETITIONS=1 RISU_BROWSER_SMOKE_WORKERS=1 pnpm test -- server/fastify/browser-smoke/transcriptResidency.spec.ts
```

All ten cases passed. There was no concurrent build or test workload. Retained
artifacts preserve every stage measurement, scroll-frame sample and post-GC heap;
repetitive request records are reduced to counts and summed durations/bytes.

| Profile | Messages / mounted rows | Elements | Post-GC heap MiB | Scroll p95 ms | Older-page layout+style p95 ms |
| --- | --- | --- | --- | --- | --- |
| Desktop | 30 | 1,225 | 15.676 | 17.2 | — |
| Desktop | 180 | 7,277 | 34.757 | 16.8 | 27.865 |
| Desktop | 600 | 24,217 | 84.751 | 16.8 | 76.959 |
| Mobile | 30 | 1,080 | 14.633 | 16.9 | — |
| Mobile | 180 | 6,382 | 31.570 | 16.8 | 25.539 |
| Mobile | 600 | 21,222 | 75.343 | 16.9 | 69.653 |
| Mobile 4× CPU | 30 | 1,080 | 14.628 | 17.5 | — |
| Mobile 4× CPU | 180 | 6,382 | 31.565 | 17.4 | 121.408 |
| Mobile 4× CPU | 600 | 21,222 | 75.355 | 17.7 | 334.143 |

All older-page anchors measured zero drift. The 600-row deep jumps took
20.726/17.211/74.686 seconds with 570 display-source responses each; these remain
combined delivery/scheduling/parser/DOM observations, not isolated layout time.
Three gated streaming chunks still pass; the first chunk returns display to 30
rows, so this does not establish sustained streaming at 600 mounted rows.
The separate full screenshot mounted 36 rows, downloaded 1,327,282 PNG bytes in
3.172 seconds and restored 30. Its canvas peak is outside the post-GC heap metric.

**Decision before implementation:** implement viewport residency. All three
large profiles still exceed the original heap and fixed-page layout budgets;
the original thresholds remain unchanged. Keep hydration and display scheduling
as their existing owners; residency selects which hydrated rows mount. The
supported measured envelope remains the same 30/180/600 rich-text histories.

## Cutover bounds and preserved workflows

- A working viewport window contains at most 60 rows, with measured-height
  spacers for omitted rows and stable message IDs. A chat-scoped height cache
  retains at most 2,048 measurements and invalidates on width changes. Existing
  bounded parser/display caches keep their current limits.
- At most eight distinct message rows may reserve long-lived interaction state
  (inline/popup/partial editors, confirmations, translations). Multiple operations
  on the same row share its slot. An additional user operation beyond that limit
  reports a localized request to finish an existing operation without discarding
  drafts; automatic translation waits for availability. At most eight additional
  singleton rows cover the latest row, navigation target, generation/reroll
  presentation, focus, a popup owner and the two selection endpoints. Thus
  ordinary residency is at most 76 rows regardless of hydrated history length.
- Existing latest-start/latest-end/user-free scroll ownership remains authoritative.
  A stable visible message and offset anchor compensates for eviction, older
  loads and measured media growth. Jump mounts its hydrated target before seeking
  DOM; folded history and normal older-page hydration remain unchanged.
- Full screenshots temporarily bypass residency when the existing capture sets
  `loadPages = Infinity`; its existing `finally` path must restore ordinary
  residency on success, failure or cancellation. Export/tokenization may hydrate
  full data without requiring full DOM materialization.
- The user's accepted product decision permits native browser text-find to see
  only mounted messages and limits cross-message drag selection. Preserve
  selection/copy within a mounted message, per-message copy, existing in-app
  navigation/search, keyboard/screen-reader access, jump and data export.
- The previous paging implementation remains available using the local diagnostic
  `risu-transcript-legacy-paging` key set to `1` before mounting a chat. This is a
  rollback option, not a claim that legacy paging meets the ordinary row bound.

Acceptance requires the unchanged cost matrix plus native browser proof of the
row bound, one-pixel anchor tolerance, interaction preservation and capture
restoration. Revisit if any supported fixture exceeds these bounds/budgets, an
interaction loses owned state, or a newly supported workflow needs unmounted
DOM. Implementation and after evidence are pending.
