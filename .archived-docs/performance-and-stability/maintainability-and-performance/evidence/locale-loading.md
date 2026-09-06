# Selected-Locale Loading Evidence

Finding F06; base `6b9b632f9`, implemented by the accompanying Phase 2d commit.
Measurements use the same Node 24.19.0, pnpm 11.23.0, Chromium 151.0.7922.34,
Linux/desktop fixture and three cold/refresh repetitions as the
[accepted baseline](locale-baseline.md). All data is synthetic and local.

## Loading and ownership

English is immediately available for entry/error copy. Six literal imports load
only the selected non-English pack; merged packs and pending imports are
memoized. A selection token prevents old success or failure from superseding a
new selection, including returning to already-applied English while another
pack is pending. Current failures retain the prior language and remain retryable.
A small framework-neutral proxy tracks language property reads; application
startup installs Svelte subscriptions before mount so existing live labels repaint.

Database/resource projection remains synchronous and starts the download as soon
as language is known. Bootstrap awaits the latest language before publishing
shell readiness, including resumed startup steps. Settings explicitly handle
async failures; onboarding awaits loading before persistence and cancels only
its own current load on destruction. Cached locale application stays synchronous.
Existing supported codes, onboarding browser-language aliases, English fallback
merging and formatter functions remain intact.

An actual Chromium 503 test showed that deleting a rejected promise from the
memo was insufficient: the browser retained the failed module URL and made no
second request. The build plugin now supplies exact emitted locale chunk URLs;
only a retry adds an incrementing query to bypass that failed module-map entry.
No error-string parsing, source-TypeScript fetch or unrequested pack prefetch is
used. Ordinary imports remain literal; successful merged packs stay cached.

## Bundle and browser comparison

`pnpm build:initial-preload` passes. [After build report](preload-after.json):

- Initial HTML JavaScript: 505,100 raw / **159,433 gzip bytes**, versus
  1,216,085 / 389,721 before. Gzip falls 230,288 bytes (59.09%), below the
  preselected 194,860-byte target. The 14-file count is unchanged.
- Initial and immediate static closures contain **English only**. The initial
  English/loader chunk remains 61,512 gzip bytes; the full old 291,801-byte
  language chunk has not been claimed as eliminated.
- Immediate appStartup closure, using the same pre-emission accounting as the
  baseline: 3,881,125 raw / **1,148,933 gzip bytes**, versus
  4,584,087 / 1,377,316. Do not mix these with emitted HTML file totals.
- The bundle report now fails if a non-English pack enters either static
  closure. Explicitly emitted locale retry entries are recognized without
  treating them as HTML preloads or admitting arbitrary extra application entries.

The exact isolated command
`RISU_BROWSER_SMOKE_WORKERS=1 pnpm test -- server/fastify/browser-smoke/selectedLocaleStartup.spec.ts`
passes one spec containing twelve cases. [All samples](locale-startup-after.json)
retain deduplicated script paths, transfer totals, first labels and milestones.

| Locale / cache | Chat-ready median ms, before → after | Background-ready median ms, before → after | Distinct-script gzip bytes, before → after |
| --- | --- | --- | --- |
| English cold | 752.8 → 699.8 | 753.8 → 708.7 | 1,393,734 → 1,165,325 |
| English refresh | 431.5 → 361.9 | 434.0 → 367.9 | 1,393,734 → 1,165,325 |
| Korean cold | 813.6 → 716.5 | 814.4 → 717.9 | 1,393,734 → 1,227,554 |
| Korean refresh | 453.8 → 379.3 | 456.5 → 381.9 | 1,393,734 → 1,227,554 |

Every first composer has its requested label and reaches background readiness
without page errors. English requests zero non-English assets; Korean requests
only Korean. These medians include the earlier Phase 2 changes and are not a
claim that every millisecond saved came from locale splitting. No production
latency estimate or strict noisy millisecond gate is inferred.

## Correctness checks

Each focused invocation uses `pnpm test --` followed by one file:

- `src/lang/index.test.ts`: 22 passed; memoization, English/formatter fallback,
  supported packs, pending replacements, canceled/obsolete failures and retry.
- `src/lang/loadLanguagePack.test.ts`: 2; retry URL resolution/query preservation.
- `util/locale-chunk-urls.test.ts`: 2; exact six build references and owner scope.
- `util/bundle-boundary-report.test.ts`: 13; emitted locale entries, both static
  closures and existing protected boundaries.
- `src/ts/bootstrap.test.ts`: 184; startup/readiness/retry contracts.
- `src/ts/server/resourceState.svelte.test.ts`: 77; projection/revision behavior.
- `src/ts/storage/database.svelte.test.ts`: 139; synchronous database application.
- `src/ts/setting/languageSettingsData.test.ts`: 9; async setting effect/error.
- `src/lib/Others/WelcomeRisu.svelte.test.ts`: 25; onboarding/persistence/unmount.
- `src/lib/UI/GUI/SideBarArrow.svelte.test.ts`: 2; live property repaint.
- `src/lib/Others/GridCatalog.svelte.test.ts`: 19; existing localized UI behavior.
- `src/lib/SideBars/sidebarMultitasking.test.ts`: 5; selected-language consumers.

`RISU_BROWSER_SMOKE_WORKERS=1 pnpm test -- server/fastify/browser-smoke/selectedLocaleRuntime.spec.ts`
passes three real UI journeys: delayed Korean → English → loaded Korean,
retry after runtime 503, and cold Korean 503 → retry before the first localized
composer. The initial memo-only retry failed this browser gate; the emitted-URL
implementation passes it. No provider requests are used.

Current UI/runtime/test guides, Prettier, whitespace and both documentation
validators pass. Final combined aggregate remains pending until all planned
implementation is complete. An offline client still needs connectivity to load
a never-loaded selected pack; English error copy and retry remain available.
