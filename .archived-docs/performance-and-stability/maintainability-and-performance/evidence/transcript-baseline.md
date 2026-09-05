# Transcript Residency Baseline and Decision Rule

Source: `c4cbb74ec`; production still matches `491cc1820`.
[Retained measurements](transcript-before.json). The full per-request generated
report remains outside the plan; this artifact retains stage counters/timings,
individual frame samples, post-GC heaps, and summed request work.

Exact isolated command (ten cases passed in 6.7 minutes):

```sh
RISU_TRANSCRIPT_COSTS=1 RISU_TRANSCRIPT_REPETITIONS=1 RISU_BROWSER_SMOKE_WORKERS=1 pnpm test -- server/fastify/browser-smoke/transcriptResidency.spec.ts
```

Node 24.19.0, Chromium 151.0.7922.34, Linux x64, AMD Ryzen 9 9950X/ten visible
CPUs. Desktop is 1280×800; mobile is 390×844 with touch/mobile emulation; the
third profile additionally uses Chromium's 4× CPU slowdown. This does not
simulate constrained RAM or a physical mobile device. No other test/build or
research tools ran concurrently. Trace recording is off because its repeated
DOM snapshots materially distort this workload.

Each profile runs 30/180/600 messages: 30 initial rows, 15 additional rows per
older-page load (0/10/38 loads), variable-height Markdown and 5/30/100 valid local
PNG images. Images explicitly decode eagerly as a stress fixture; ordinary
parser-default images are lazy. Serialized fixture sizes are
13,326/72,818/239,306 bytes. Each case starts cold, then reloads warm before a
bookmark jump. One whole journey is measured per case with no discarded warmup;
each scroll sample has 48 frame intervals and traversal supplies repeated
incremental-page samples. Phase 5 repeats this exact matrix after earlier work.

| Profile | Messages / mounted rows after traversal | Transcript elements | Retained JS heap MiB after GC | Scroll frame p95 ms | Incremental-page layout+style p95 ms |
| --- | --- | --- | --- | --- | --- |
| Desktop | 30 | 1,225 | 16.534 | 16.9 | — |
| Desktop | 180 | 7,277 | 35.590 | 16.8 | 26.438 |
| Desktop | 600 | 24,217 | 85.295 | 16.9 | 59.954 |
| Mobile | 30 | 1,080 | 15.559 | 16.9 | — |
| Mobile | 180 | 6,382 | 32.432 | 16.8 | 24.556 |
| Mobile | 600 | 21,222 | 76.052 | 16.8 | 76.950 |
| Mobile 4× CPU | 30 | 1,080 | 15.542 | 17.6 | — |
| Mobile 4× CPU | 180 | 6,382 | 32.436 | 17.5 | 128.516 |
| Mobile 4× CPU | 600 | 21,222 | 76.041 | 21.2 | 365.370 |

All older-page and late-image anchors remain at zero measured pixel delta.
The visible row window grows with traversal; initial paging already works.
The probe separately verifies three manually gated provider chunks and durable
completion. Send admission can briefly retain 601 rows before the first chunk
resets display to 30; this is not sustained streaming at 600 mounted rows.

Deep jumps at 600 messages take 20.326/18.313/79.045 seconds for desktop/mobile/
4× CPU and request 570 display-source responses. Their CDP layout durations are
0.814/0.783/4.223 seconds, with 0.317/0.985/0.619 seconds from final display
response to settled observation. Those wall times include scheduling, scripted
display preparation/delivery, parser work, mounting, and probe settling frames;
they are not isolated parser or DOM CPU. A residency decision must not attribute
the entire jump delay to layout, nor hide this retained user-visible cost.

## Decision rule set before optimization

The measured interactive envelope is up to 600 rows of this explicit rich-text
fixture; larger/other payloads are not inferred to be fast. The intermediate
180-row fixture provides a reference for repeated fixed 15-row interactions.
After Phase 4, decide whether a resident bound is justified using:

- Accumulated scrolling p95 should stay within twice the small-profile baseline:
  33.8 ms desktop/mobile, 35.2 ms under CPU slowdown.
- Large-case incremental-page layout+style p95 should stay within twice the
  intermediate case: 52.876/49.112/257.032 ms respectively. This allows measured
  margin while rejecting work proportional to all accumulated rows for a fixed
  15-row action.
- Retained interactive JS heap should stay within twice the intermediate case:
  71.180/64.864/64.873 MiB. Compare post-GC heap, not a transient allocation peak
  or total browser-process RSS. Temporary capture memory is separate.
- Preserve zero material anchor drift (the existing browser tolerance remains
  one pixel), editing/focus/selection, jump/reroll/translation, and accessibility.

Current large fixtures exceed the incremental-page and retained-heap comparison
budgets, while ordinary scrolling stays within budget. Phase 5 must remeasure
and evaluate viewport residency versus an explicit resident-page bound. Any
retention decision must explain the supported workflow tradeoff and these
remaining costs, with an owner and precise revisit trigger; it cannot claim
that mounted rows are bounded or that deep jumps are fast. Merely reducing the
fixture or raising these budgets is not a resolution.

## Full-transcript workflows

Bookmark preparation can hydrate the full transcript on a chat-list route with
zero transcript rows mounted. Export/tokenization similarly need full data,
not necessarily full display residency. Ordinary browser text-find and copying
currently see all mounted rows accumulated in a visit; a proposed bound must
document and preserve access to those workflows before cutover.

The separate screenshot case performs the actual PNG download with 36 rows,
observes a peak of 36, restores 30, and validates 1,327,282 PNG bytes. Its measured
3.839-second capture includes encoding/download; post-operation JS heap does
not include peak canvas memory. Capture is an explicit temporary full-display
workflow outside the interactive bound. The ordinary test lane keeps only the
desktop/mobile 30-row cases and screenshot; the full matrix is opt-in.
