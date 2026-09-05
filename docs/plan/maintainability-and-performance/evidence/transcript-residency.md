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
  drafts; automatic translation waits for availability. Singleton pins cover the latest row, navigation target, generation/reroll
  presentation, focus, a popup owner and the two selection endpoints. Up to
  four generation identities may briefly coexist (old/new regeneration IDs,
  target and append presentation), so there can be ten singleton IDs. Pins
  consume the shared budget first: reduce the working window below 60 when
  needed to keep the original **76-row hard limit**. This refines the initial
  eight-singleton estimate without increasing the accepted row bound.
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
DOM. Interaction ownership shipped in `9c8e678d2`: focused Chat 63, partial-editor 12,
interaction-scope 5, view-cache 3 and reservation-manager 3 tests pass. The first
seven native cases pass on the in-progress cutover, including editing, selection,
copy, folded history and capture success/failure/cancellation. They exposed a
queued bookmark entering before its route/component and a hidden-but-retained
screen allowing capture revival; both have focused fixes pending the cutover
commit. Final native verification and unchanged after-cost evidence remain open.

### Cutover correctness checks

`b5371f408` gives inline/popup editors a separate draft and preserves stable
message identity through unrelated earlier deletions. Chat 66 and partial-edit
freshness 11 cases pass, including unchanged-source rejection. On the working
cutover, the eight-case native run passes without diagnostic instrumentation:
`/tmp/phase5-transcript-functional-final-6.log`. The stress case retains eight
drafts through viewport movement and a page setting reduction, refuses a ninth
without losing work, verifies exactly one accepted save per message plus exact
authoritative saved text, then returns to a fresh 14-row configured window after
release. It also tests keyboard activation of a stable, named spacer control.

The pointer stress exposed focus releasing an older pin between pointerdown
and pointerup, changing reverse-scroll geometry and losing the click. A bounded
pointer hold now retains the logical lower edge and defers residency geometry
until the click sequence finishes; cancel/blur/destroy release it. A read-only
review also found generation IDs being pinned after logical truncation and an
old jump surviving a hidden route. Generation identities now protect the lower
logical bound before truncation; visible-route departure/destruction invalidate
pending jumps while initial bookmark handoff can still wait for its new route.
The older-generation page-reduction component regression passes, along with the
105-case transcript-window suite. The expanded nine-case native run passes:
desktop/mobile unfolding stays within one pixel and a pending image-backed jump
cannot move the reopened chat through its old wait deadline or image completion.
The fold regression first exposed 3–5 pixel drift: the corrected owner retains
the intended folded-row offset through successive parser/image changes instead
of recapturing rounded browser scroll positions. The original tolerance is
unchanged. The final ten-case functional lane also passes diagnostic rollback
with 180 mounted rows, no spacers, ten older-page anchors within one pixel, deep
jump and latest navigation. It bypasses residency observers/reconciliation and
restores native anchoring; interaction admission remains active. The existing
`chatStartupRendering.spec.ts` (3) and `debugEchoLayoutStability.spec.ts` (1)
real-browser cases also pass, including delayed display readiness, latest-row
anchors, first-token waiting and foreground recovery. All 14 required native
functional cases pass; unchanged full cost-matrix acceptance remains pending.

## First isolated cutover measurement: scrolling still open

Source `497aa1eaf`; [all ten retained cases](transcript-residency-first-costs.json).
The unchanged isolated cost command completed ten measured cases in four minutes;
seven functional-only cases were intentionally skipped. All measured geometry
and row assertions passed. Every measurement/frame is retained; no sample or
budget was removed. Functional success does not imply timing acceptance.

| Profile | Messages | Mounted rows after traversal | Post-GC heap MiB | Scroll p95 ms | Older-page layout+style p95 ms |
| --- | --- | --- | --- | --- | --- |
| Desktop | 30 | 30 | 16.057 | 16.9 | — |
| Desktop | 180 | 61 | 29.149 | 49.5 | 19.204 |
| Desktop | 600 | 61 | 30.384 | 67.5 | 18.234 |
| Mobile | 30 | 30 | 14.946 | 16.9 | — |
| Mobile | 180 | 61 | 26.436 | 38.0 | 15.175 |
| Mobile | 600 | 61 | 29.121 | 64.2 | 17.756 |
| Mobile 4× CPU | 30 | 30 | 15.019 | 18.0 | — |
| Mobile 4× CPU | 180 | 61 | 27.594 | 177.8 | 84.116 |
| Mobile 4× CPU | 600 | 61 | 29.190 | 288.6 | 76.225 |

All large heap and page-layout budgets pass, but rapid scrolling exceeds the
original 33.8/33.8/35.2 ms limits. Phase 5 remains open. All accumulated windows
remain at 61 mounted rows; maximum measured anchor drift is 0.015625 pixels.
Large jumps take 2.325/2.343/6.352 seconds, with 60 display-source responses each.
Screenshot materialization remains separate: 36 peak rows, 30 restored rows,
1,327,282 PNG bytes and 3.576 seconds.

Two independent read-only source checks identify per-frame window replacement,
row construction and forced geometry as likely contributors. Background
Markdown already uses a serial idle scheduler; the entire Chat subtree still
mounts synchronously. A diagnostic CPU profile will distinguish that work before
the next implementation. No phase acceptance, latency-budget amendment or
fixture change is authorized by these failed measurements.

### Profile-guided admission correction

[The separate CPU profile summary](transcript-scroll-profile.json) attributes
49.5% inclusive sampled time to row construction, 16.33% to sanitization and
12.58% to residency reconciliation; these inclusive stacks overlap. The
profiled sweep is diagnostic and cannot substitute for an unprofiled budget
comparison. Existing parse memoization and background scheduling already exist;
the new cost comes from replacing many complete row components each frame.

The correction retains the original 60-working/76-hard limits and admits the
nearest missing ordinary row per animation frame, replacing at most one old
ordinary row. Interaction/navigation pins remain immediate. The current target
supersedes intermediate unmounted windows; no growing work queue or display
cache is added. Admission preserves existing stable IDs and stops once all
desired rows are present. Review supplied an asymmetric 58-row/18-pin window
counterexample; eviction now removes outside-window rows first and computes
pending state from final membership. Eight geometry/admission tests pass.

The first functional attempt exposed jump release dropping its highlighted
component before ordinary admission; bounded admission state now retains pins
ahead of ordinary rows so release transfers the same component. A second native
Save6 failure retained every draft but showed pointerdown on Save and pointerup
on the textarea 22 ms later: a neighboring pending body changed height. The
ordinary pointer hold now snapshots at most 76 wrapper sizes through the click
sequence; cancellation/blur/full capture/chat change/destruction restore them.
These failures remain distinct from timing acceptance and do not retry saves.

The cost probe retains the same 48 input frames and separately measures complete
post-scroll settlement before forced GC, including readable visible content and
spacer coverage. This makes any shifted work visible. Native interaction and
unprofiled cost verification remain required before accepting the correction.

The corrected eleven-case normal browser lane passes without profiling/traces.
All eight single-click saves are accepted exactly once and preserve authoritative
draft text. The independent rapid-motion case records 22 newly visible message
IDs and 32 readable samples while admission is pending, retaining 40 transient
placeholder samples as well. Final coverage is 784/784 pixels with source-correct
rows 141/142, zero visible spacer pixels, and 61 mounted/180 logical rows.
[Complete rapid-motion samples](transcript-rapid-movement.json) remain separate
from unprofiled cost acceptance. Focused transcript-window 105, startup 4 and
geometry/admission 8 tests pass. The rapid-motion report records parent HEAD
`4154dade9` plus this progressive-admission worktree; the next isolated cost
report must use its clean implementation commit.

### First progressive cost attempt: older-page anchor remains open

Source `547f927b3`; [retained completed journeys and failure](transcript-residency-progressive-first-costs.json).
Desktop30/180 complete with scrolling p95 16.9/18.3 ms; desktop180 has 1.161
seconds of separately measured settlement and 26.285 MiB retained heap. The
next desktop600 journey stops at older-page31 with 13 pixels of anchor drift.
Remaining serial cases do not run. The original one-pixel tolerance is unchanged.
That probe wrote journeys only after completion, so the failed journey's earlier
in-memory stages are unavailable; failure-only partial serialization is now
required before another comparison.

Progressive insertion makes Map order differ from visual row order. The next
anchor correction selects the first visible row by geometry; preserving a lower
neighbor while its body finishes parsing can otherwise move the oldest row.
All eleven native cases pass with visual-order anchoring. A subsequent related
correction captures a changed free-scroll position synchronously, before awaited
body/hydration updates can alter it ahead of the reconciliation frame. That
addition requires the fresh cost build and final native run. Failure-only probe
serialization preserves completed samples and the failing sampled stage before
throwing, without additional reads/writes on successful measurement paths.

### Anchor-corrected comparison: page-settlement probe gap

Source `76db02c20`; [four completed journeys and the full partial failure](transcript-residency-anchor-first-costs.json).
Desktop30/180/600 and mobile30 complete. Desktop600 preserves all 38 older-page
anchors and records 19.8 ms scrolling p95, 29.672 MiB retained heap, and 29.036
ms older-page layout/style p95. Its separately measured post-scroll settlement
is 2.902 seconds. These partial results do not accept the whole matrix.

Mobile180 stops at older-page4 with a reported 548-pixel delta. The captured
row109 was already 1,451.234 pixels below the viewport top; the viewport is only
784 pixels tall. The probe chose the last mounted DOM row without checking its
visibility. Its previous page completion waited for currently mounted bodies
and images, but did not wait for progressive admission to finish, so the next
scroll could land in a still-unmounted gap. The retained partial report contains
all preceding stages, the actual failing sample, and separately timestamped
post-failure row/spacer geometry; later measured cases did not run.

The probe correction includes admission completion in each existing measured
page action, verifies current bodies/images again after settling frames, and
requires a visible anchor when the unchanged older-edge scroll is applied.
It preserves the exact page count, scroll positions, 48-frame sweep, and original
row/heap/layout/one-pixel budgets. This strengthens page completion and includes
deferred work in the measured page cost. A fresh complete matrix remains
required; the offscreen assertion is not silently deleted or treated as a pass.
