# Browser Smoke Review Inventory

Planning snapshot: 2026-09-06 at
`ac5a1cec1dc2e74354001fe7f86b372048e691fd`.

All rows are pending. Counts came from Playwright discovery, not browser
execution. Reconcile this snapshot against the execution source in Phase 0.
The [plan](PLAN.md) defines scope; [status](status.md) owns the execution cursor.

## Default Registered Cases

All spec names below resolve under `server/fastify/browser-smoke`.

| Spec                                       | Default cases | Primary review phase                      | Review state                     |
| ------------------------------------------ | ------------: | ----------------------------------------- | -------------------------------- |
| `acceptedSendProtocol.spec.ts`             |            11 | 2: generation/recovery                    | Pending                          |
| `bardWikiLifecycle.spec.ts`                |             1 | 3: memory lifecycle                       | Pending                          |
| `chatHistoryScroll.spec.ts`                |             2 | 2: transcript                             | Pending                          |
| `chatStartupRendering.spec.ts`             |             3 | 2: transcript/startup                     | Pending                          |
| `debugEchoLayoutStability.spec.ts`         |             1 | 2: generation/layout                      | Pending                          |
| `displayPaintCache.spec.ts`                |             1 | 3: startup/cache                          | Pending                          |
| `fastifyBrowserSmoke.spec.ts`              |            10 | 2: critical slices; 3: remaining journeys | Pending                          |
| `lazyFirstOpen.spec.ts`                    |             8 | 3: navigation/first open                  | Pending                          |
| `rerollSwipePersistence.spec.ts`           |             1 | 2: generation durability                  | Pending                          |
| `selectedLocaleRuntime.spec.ts`            |             3 | 3: locale transitions                     | Pending                          |
| `selectedLocaleStartup.spec.ts`            |             1 | 3: locale startup                         | Pending                          |
| `startupCachePopulationMatrix.spec.ts`     |             1 | 3: startup/cache                          | Pending                          |
| `startupDirectLinks.spec.ts`               |             4 | 3: route matrix                           | Pending                          |
| `startupRecoveryIntegrationMatrix.spec.ts` |             7 | 2: stale-response recovery                | Pending                          |
| `transcriptResidency.spec.ts`              |            12 | 2: transcript; 3: remaining interactions  | Pending                          |
| `visibleStateRecovery.spec.ts`             |             3 | 2: visible/durable recovery               | Pending                          |
| **Total**                                  |        **69** |                                           | **No scenario review completed** |

This file-level table is the starting universe. Phase 0 adds records keyed by
spec plus full test title and meaningful subjourney/parameter labels. A whole
file cannot be marked reviewed after sampling a few of its scenarios. Keep
opt-in workload expansion, conditional skips, desktop/mobile profiles, and
manifest-generated route coverage explicit without inflating default counts.

## Shared Owners to Review

| Owner                                                                                                                                              | Review question                                                                                                | State   |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------- |
| `server/fastify/browser-smoke/fastBootstrapHarness.ts` and harnesses embedded in specs                                                             | Does setup preserve the route/storage contracts being claimed, and which workers/configurations differ?        | Pending |
| `server/fastify/browser-smoke/auth.ts`, `globalSetup.ts`, `globalTeardown.ts`, `globals.d.ts`                                                      | What is supplied globally, bypassed, reset, or shared across tests?                                            | Pending |
| `server/fastify/browser-smoke/englishFixture.ts`, `selectedLocaleFixture.ts`, `transcriptResidencyFixture.ts` and inline fixtures                  | Which producer/schema/history supports the fixture, and does setup pre-complete the action?                    | Pending |
| `server/fastify/browser-smoke/fastBootstrapDirectLinks.ts`                                                                                         | Does the generated route matrix cover its named journeys and render assertions?                                | Pending |
| `server/fastify/browser-smoke/fastBootstrapIntegrationArtifact.ts`                                                                                 | Can missing/stale/partial evidence be mistaken for successful integration?                                     | Pending |
| `src/ts/server/browserSmoke.ts` and the shared hook type it imports                                                                                | Which callers observe, seed, inject a fault, or drive the action under test?                                   | Pending |
| `src/appStartup.ts`, `src/ts/observerShellFlag.ts`, `src/ts/storage/fastifyStorage.ts`, `src/ts/process/generationPersistenceState.ts`             | Which smoke-only startup, auth, observer, or timing branches change the claim?                                 | Pending |
| `playwright.fastify-smoke.config.ts`, `util/focused-test.ts`, `util/browser-smoke-workers.ts`, `util/test-all.ts`, `.github/workflows/quality.yml` | What is discovered, skipped, isolated, built, executed, or required by each lane?                              | Pending |
| Browser API overrides, request controls, and assertion helpers within every spec                                                                   | Does the control preserve the failing transition and does the assertion independently observe its consequence? | Pending |

The local support baseline is ten TypeScript files, 952 lines. Follow imports
when they reveal additional shared owners; add only dependencies relevant to a
named test claim. Existing screenshot assets remain companion artifacts of
their scenario, not independent passing tests.

## Scenario Record

Each reviewed record must contain:

- Stable ID, spec/full title, subjourney or meaningful parameter, source anchor.
- Named behavior and failure mode; risk and production entry point.
- Fixture provenance and precondition; controlled/replaced boundaries and why.
- Action actually executed, including whether UI/queue/route/storage is bypassed.
- Independent visible/durable assertion and relevant pending-state assertions.
- Companion lower-layer evidence and explicit remaining scope limits.
- Execution command, conditional environment, and required browser profile.
- Disposition, finding references, fault demonstration reference when required.

Dispositions: pending, partial, retained, strengthened, reclassified, or removed
with replacement evidence. Missing critical journeys receive their own records
and findings instead of being omitted because no test title exists yet.
