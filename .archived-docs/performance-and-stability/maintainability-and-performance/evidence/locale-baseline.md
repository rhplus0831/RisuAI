# Locale Startup Baseline and Budgets

Production source: `491cc1820`; no F06 implementation changes. Node 24.19.0,
pnpm 11.23.0, Chromium 151.0.7922.34, Linux x64, AMD Ryzen 9 9950X with ten
visible CPUs. Browser uses desktop defaults with no CPU throttle.

## Build closures

`pnpm build:initial-preload` passed.
[Retained production report](preload-before.json): the initial HTML references
14 JavaScript files totaling 1,216,085 raw / 389,721 gzip bytes. The language
chunk contains all seven packs and accounts for 904,254 raw / 291,801 gzip
bytes. Rollup's separate immediate-startup closure reports 4,584,087 raw /
1,377,316 gzip bytes across 1,203 modules. Do not mix the Rollup report's earlier
render-stage closure accounting with the emitted HTML-file accounting.

## Browser readiness and observed transfer

Exact isolated command:

```sh
RISU_BROWSER_SMOKE_WORKERS=1 pnpm test -- server/fastify/browser-smoke/selectedLocaleStartup.spec.ts
```

One spec passed, containing twelve cases (English/Korean × cold/refresh × three
repetitions). Each repetition starts with a fresh browser context and origin;
its refresh reuses HTTP/cache state. No warmup case is discarded.
[Raw startup/transfer samples](locale-startup-before.json) retain browser version,
all milestone timings, first composer labels, and actual requested scripts.
The smoke build is used for both browser comparisons; this transfer closure
includes the selected chat route and test hooks, unlike the production HTML
preload closure.

| Locale / cache | Median chat-ready ms from entry | Median background-ready ms | Gzip bytes of observed distinct scripts |
| --- | --- | --- | --- |
| English cold | 752.8 | 753.8 | 1,393,734 |
| English refresh | 431.5 | 434.0 | 1,393,734 |
| Korean cold | 813.6 | 814.4 | 1,393,734 |
| Korean refresh | 453.8 | 456.5 | 1,393,734 |

The first materialized composer has the requested localized accessible label in
all twelve cases. All reach background readiness without page errors. These are
synthetic local startup measurements, not production speed estimates.

## Targets set before Phase 2d

- Initial locale membership: one fallback pack and zero unrequested non-English
  packs. Requested non-English startup may load exactly that second pack.
- Initial HTML JavaScript gzip bytes: at most half baseline (194,860 bytes).
  Existing historical budget ceilings remain unchanged.
- Immediate-startup graph: zero unrequested locale packs and reported gzip bytes
  below 1,377,316. Browser-observed distinct-script gzip bytes must fall below
  1,393,734 for both English and Korean, accounting for the selected locale.
- Preserve the first usable localized composer and successful startup milestones.
  Compare each readiness median against its corresponding baseline above;
  investigate regressions with matched repeated samples rather than hiding a
  loading waterfall behind reduced preload bytes.
- Runtime switching must preserve English fallback merging, aliases, latest
  selection ordering, memoized imports, and retry after a failed locale chunk.
  Synchronous settings/database application must explicitly arrange language
  readiness; a failed request must not mark its locale applied.

The existing `src/lang/index.test.ts` passed twelve cases before the cutover;
Phase 2d will extend async ordering/retry coverage and update all synchronous
consumers deliberately. The source inventory finds consumers in database
application, resource state, onboarding, and language settings. The entry
`src/main.ts` needs reliable synchronous English for preload failures.
