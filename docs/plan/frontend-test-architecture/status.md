# Frontend Test Architecture Status

Date: 2026-08-28

This is the live router for the frontend test runtime architecture workstream.
Use it first, then open only the active phase or slice. The current runner and
codebase remain authoritative until a phase lands.

## Current Snapshot

- Plan state: Phases 0-4 complete; Phase 5 pending.
- Current phase: Phase 5 — DOM Contract Consolidation (pending).
- Active slice: None; Phase 4 is complete.
- Implementation state: Chat-import request planning, Saved Toggles planning,
  and router route planning now have 21 pure Node tests. Retained Happy-DOM
  suites still own durable commands, mounted settings, browser history, store
  application, and asynchronous route freshness.
- Blockers: None. Ninety-three retained target-S candidates have recorded Phase
  4/5 owners and revisit conditions.
- Next action: Re-profile repeated Happy-DOM mount/setup owners and prepare the
  first Phase 5 visible-behavior consolidation slice.

## Phase Router

| Phase | State | Purpose |
| --- | --- | --- |
| [0](phases/phase-0-baseline-and-classification.md) | Complete | Ratified metrics, capability rules, and discovery/completeness proof. |
| [1](phases/phase-1-runtime-topology.md) | Complete | Added and piloted the Node, Svelte+Node, and Happy-DOM topology. |
| [2](phases/phase-2-pure-node-promotion.md) | Complete | Promoted already-pure tests to Node and recorded every retained N candidate. |
| [3](phases/phase-3-svelte-node-promotion.md) | Complete | Promoted Svelte-compiled tests that do not require DOM behavior. |
| [4](phases/phase-4-pure-logic-extraction.md) | Complete | Extracted measured pure-logic seams while retaining DOM contracts. |
| [5](phases/phase-5-dom-contract-consolidation.md) | Pending | Consolidate repeated DOM setup and clarify visible-state ownership. |
| [6](phases/phase-6-routing-and-ci-enforcement.md) | Pending | Enforce explicit routing and align affected tests, coverage, aggregate execution, and CI. |
| [7](phases/phase-7-verification-and-closeout.md) | Pending | Prove final budgets and behavior, update current docs, and archive the workstream. |

## Formal Phase 0 Baseline

| Measurement | Result |
| --- | ---: |
| Full classified Vitest universe | 537 files |
| `test:all` ordinary frontend | 529 files / 6,413 tests |
| Warm standalone wall median | 72.30s (69.71-72.34s) |
| Warm Vitest duration median | 71.23s |
| Warm peak RSS median | 4,785,288 KiB |
| Node ordinary project | 125 files / 771 tests / 4.06s wall |
| Happy-DOM ordinary project | 404 files / 5,642 tests / 70.67s wall |
| Focused UI coverage | 6 files / 203 tests / 20.13s wall |
| Full `test:all` | 208.53s wall |
| Primary target | 57.84s ordinary frontend wall median |
| Stretch target | 50.61s ordinary frontend wall median |

The candidate inventory contains 174 N, 129 S, 234 D, and 7 B files. See
[`phase-0-classification.md`](phase-0-classification.md) for routing, setup, and
pilot decisions and [`phase-0-inventory.tsv`](phase-0-inventory.tsv) for the
per-file record.

## Phase 1 Topology Result

| Measurement | Result |
| --- | ---: |
| Full three-project universe | 537 files: 126 N / 2 S / 409 D |
| `test:all` ordinary frontend | 529 files / 6,413 tests: 125 N / 2 S / 402 D |
| Warm wall median | 73.07s (70.44-75.22s) |
| Warm Vitest duration median | 72.05s |
| Warm peak RSS median | 4,800,148 KiB |
| Wall delta from Phase 0 | +1.1% (within 5% topology budget) |
| Peak-RSS delta from Phase 0 | +0.3% (within 10% guard) |

`frontend-svelte-node` owns the two validated S pilots through an explicit
transitional inventory. It uses Vitest's Node setup without DOM globals and
Vite's client transform so Svelte client runes such as `$effect` remain active.
The Happy-DOM fallback excludes both the N and S inventories. The checked
inventory remains exhaustive and disjoint in full, standalone ordinary, and
aggregate ordinary views; 175 unpromoted N/S candidates still require probes.

## Phase 2 Cumulative Result

| Measurement | Result |
| --- | ---: |
| Completed slices and proof batches | 18 |
| Promoted suites | 35 files / 176 tests |
| Full three-project universe | 537 files: 161 N / 2 S / 374 D |
| Standalone ordinary frontend | 535 files: 161 N / 2 S / 372 D |
| `test:all` ordinary frontend | 529 files / 6,413 tests: 160 N / 2 S / 367 D |
| Remaining target-runtime mismatches | 140: 13 N / 127 S |
| Latest paired ordinary wall observation | 66.60s -> 68.24s (+2.5%) |
| Latest paired ordinary peak RSS | 4,696,532 -> 5,128,488 KiB |
| Phase 2 warm ordinary wall median | 69.50s (68.75-69.55s) |
| Phase 2 warm Vitest duration median | 68.60s (67.84-68.65s) |
| Phase 2 warm peak RSS median | 4,866,016 KiB |
| Wall delta from Phase 0 | -3.9% |
| Peak-RSS delta from Phase 0 | +1.7% |

The paired timing is slice evidence, not a phase-level median. The +2.5% wall
movement remains inside ordinary run-to-run variability; it is not a
phase-level performance claim. The three-run closeout median establishes a
3.9% ordinary wall improvement from Phase 0 while staying inside the 10% RSS
guard. The workstream-wide 20% target remains open for Phases 3-7. No Phase 2 N
candidate remains unprobed. The 13 generated N mismatches are all probe-backed
retainers under recorded Phase 3, Phase 4, or DOM-contract owners.

## Phase 3 Cumulative Result

| Measurement | Result |
| --- | ---: |
| Completed slices and proof batches | 7 |
| Promoted to Svelte+Node | 15 files / 159 tests |
| Promoted to Node after cross-check | 28 files / 312 tests |
| Full three-project universe | 537 files: 189 N / 17 S / 331 D |
| Standalone ordinary frontend | 535 files: 189 N / 17 S / 329 D |
| `test:all` ordinary frontend | 529 files: 188 N / 17 S / 324 D |
| Broad target-S probe result | 34 passed / 93 blocked |
| Retained target-S blockers | 93 files / 1,503 tests |
| Remaining static mismatches | 97: 4 N / 93 S, all probe-backed |
| Unprobed Phase 3 candidates | 0 files |
| Cold ordinary frontend | 72.59s wall / 71.73s Vitest |
| Warm ordinary wall median | 68.47s (66.76-70.70s) |
| Warm Vitest duration median | 67.41s |
| Warm peak RSS median | 5,019,644 KiB |
| Wall delta from Phase 0 | -5.3% |
| Peak-RSS delta from Phase 0 | +4.9% |
| Focused UI coverage | 6 files / 203 tests / 19.76s wall |
| Full `test:all` | 204.98s wall |

The first slice promoted only suites with exact Phase 2 Svelte+Node evidence.
The complete 127-file target-S probe then passed 34 candidates and failed 93 at
exact browser or import-graph boundaries. A Node cross-check passed 28 of the
34, correcting false-positive S classifications caused by type-only or otherwise
Node-safe Svelte imports; six require the client transform because Node reaches
`$state`.

The formal warm median improves 3.83s (5.3%) from Phase 0 while the 4.9% RSS
increase remains inside the 10% guard. The 57.84s primary target is not met, so
Phase 4 proceeds with the current profile ranking. Svelte+Node remains a durable
layer at 17 aggregate ordinary files / 167 tests and 341ms environment time.
The approved Phase 4 order is chat-command boundaries, settings projection,
server-backed fixture planning, then router state.

## Phase 4 Cumulative Result

| Measurement | Result |
| --- | ---: |
| Completed slices and proof batches | 4 |
| Pure Node owners | 3 files / 21 tests |
| Full three-project universe | 539 files: 192 N / 17 S / 330 D |
| Standalone ordinary frontend | 537 files: 192 N / 17 S / 328 D |
| `test:all` ordinary frontend | 531 files / 6,423 tests: 191 N / 17 S / 323 D |
| Cold ordinary frontend | 69.10s wall / 68.00s Vitest |
| Warm ordinary wall median | 70.10s (68.49-70.32s) |
| Warm Vitest duration median | 69.22s |
| Warm peak RSS median | 4,893,640 KiB |
| Wall delta from Phase 3 | +2.4% (inside 5% noise) |
| Wall delta from Phase 0 | -3.0% |
| Focused candidate Vitest sum | 12.93s -> 9.35s (-27.7%) |
| Focused UI coverage | 6 files / 203 tests / 19.48s Vitest |
| Full `test:all` | 3m18.8s wall |

Chat-import and Saved Toggles planners moved into plain TypeScript leaves;
router route planning gained an environment-independent Node matrix. Durable
command, mounted settings, history/store/freshness, and both fixture corpora
remain integration-owned. Fixture planning was rejected because its available
helpers are test-only and cannot reduce the real `sendChat`/Fastify graph.

The selected focused scopes improve 27.7%, beyond focused noise, while the
whole-lane warm median is statistically unchanged from Phase 3 under parallel
scheduling. The primary target remains open. Further Phase 4 extraction stops:
remaining measured costs lack a cohesive production pure seam, and repeated
DOM setup now belongs to Phase 5.

## Current Decisions

1. Use suffix routing as the end state: plain `*.test.ts` defaults to N,
   `*.svelte-node.test.ts` routes to S, Svelte/component and `*.dom.test.ts`
   files route to D, and Playwright specs remain B.
2. Retain explicit legacy inventories during migration. The generated
   classifier is evidence, not runtime routing authority.
3. Every current Happy-DOM file proposed for N or S requires a target-project
   probe before migration.
4. Keep `vitest.setup.ts` shared by N/S/D; load the Svelte plugin without DOM
   setup in S; keep Happy-DOM and the unexpected-fetch guard exclusive to D.
5. Preserve per-file isolation. Global `--no-isolate` remains rejected.
6. Use the checked exhaustive/disjoint proof for full, standalone ordinary, and
   aggregate ordinary discovery views.
7. The Phase 1 pilots validated `sentenceBreaks.test.ts` in N,
   `chatVar.svelte.test.ts` and `stores.runtimeEffects.svelte.test.ts` in S,
   and `CheckInput.svelte.test.ts` in D.
8. Reassess Phase 4 breadth after Phases 1-3. Meeting the primary target early
   narrows later extraction scope.
9. The first Phase 2 slice validated `characterSummaryProtocol.test.ts`,
   `shellProtocol.test.ts`, and `startupTelemetryProtocol.test.ts` in N without
   changing their assertions or production dependencies.
10. The second Phase 2 slice validated `util/test-all.test.ts`,
    `vitest.fetchGuard.test.ts`, and `vitest.setup.test.ts` in N while retaining
    the DOM-only fetch-guard installation for D-owned suites.
11. The third Phase 2 slice validated the three filesystem-backed accessibility
    source-policy suites in N without moving any mounted accessibility contract
    out of D.
12. The fourth Phase 2 slice validated five plain client policy, validation,
    and data-shaping suites in N while retaining their existing dependency
    boundaries and leaving browser-shaped contracts in D.
13. The fifth Phase 2 slice validated the dependency-injected runtime polyfill
    and explicitly stubbed source-map translation suites in N while leaving
    genuine DOM utility contracts in D.
14. The sixth Phase 2 slice validated four model/provider discovery, credential,
    cache, and data-shaping suites in N while retaining Svelte-owned profile
    state and all real network behavior outside the slice.
15. The seventh Phase 2 slice validated three prompt conversion, tokenization
    memo/debounce, and tokenizer cache/catalog suites in N while retaining
    browser-only tokenizer paths and Svelte/rendered prompt contracts outside
    the slice.
16. The eighth Phase 2 slice validated generation runtime registration,
    server-backed inlay finalization planning, and raw-caller source policy in
    N. `generationEffectLedger.test.ts` and
    `recoveredGenerationEffects.test.ts` remain in D because their target Node
    probes executed transitive Svelte rune modules and failed with `$state is
    not defined`; no mocks or production boundaries were weakened to promote
    them.
17. The ninth Phase 2 slice validated legacy-memory notice detection and
    dismissal state plus startup telemetry buffering, opt-in, transport, and
    failure isolation in N. Existing mocks continue to replace the Svelte
    projection, settings persistence, alert, and authenticated transport
    boundaries; no browser-shaped contract moved out of D.
18. The tenth Phase 2 slice validated Risu-Kei backup state, strict dataset
    export sequencing, and the Fastify RisuSave cache gate in N. A broader Node
    probe retained `storage/backup.test.ts` in D because seven file-picker
    contracts require `HTMLInputElement`; the test and production DOM boundary
    were not weakened for promotion.
19. The hydration-reads Node proof failed before collection because
    `hydrationReads.ts` reaches `$state` initialization in
    `resourceState.svelte.ts` through `resourceReads.ts`. The same 12-test suite
    passed in `frontend-svelte-node`, so it remains in D pending deliberate
    Phase 3 S promotion; no mock or production boundary was weakened to force
    an N promotion. Owner: Phase 3 client-server S promotion. Revisit when
    Phase 3 begins, or earlier only if the production import graph removes the
    transitive rune dependency and a fresh Node probe passes.
20. The eleventh Phase 2 promotion slice corrected
    `alert.importSafety.test.ts`'s stale `stores.svelte` mock to the actual
    `stores/coreStores.svelte.ts` dependency and promoted its one lazy-import
    oracle to N. The uncorrected target probe failed at that module's `$state`
    initialization; the aligned dependency replacement restored the test's
    original import-isolation boundary without changing production alert
    behavior or moving the full alert service out of D.
21. The character-card PNG import Node proof failed before collection because
    `characterCards.ts` reaches `$state` initialization in
    `resourceState.svelte.ts` through `resourceWriteGuard.svelte.ts`. The
    unchanged 21-test suite passed in `frontend-svelte-node`, so it remains in
    D pending deliberate Phase 3 S promotion; no mock or production boundary
    was weakened to force an N promotion.
22. The prompt-toggle durability Node proof failed before collection because
    the real pending-mutation outbox reaches `$state` initialization in
    `persistenceActivity.svelte.ts`. The unchanged two-test suite passed in
    `frontend-svelte-node`, so it remains in D pending deliberate Phase 3 S
    promotion; its explicit IndexedDB and command fakes were not weakened.
23. The chat-generation toggle-preset Node proof reached a core-store `$state`
    initializer in N and an eager `window.innerWidth` read in S. The unchanged
    five-test suite therefore remains D-owned; extracting its pure helpers is a
    Phase 4 decision and was not folded into this promotion phase.
24. The plugin slice promoted the 14-test semantic-version and update-planning
    suite to N without changing its fakes or production dependencies. The
    two-test icon-safety suite remains D because its real DOMPurify sanitizer is
    the security behavior under test and is not callable in the plain Node
    binding.
25. The MCP and transformer slice promoted six Google-search shaping and
    device-selection tests to N. The three-test internal-client suite remains D
    because two directory-handle reuse cases execute the real filesystem
    client's `window`-owned picker capability.
26. The final server-resource proof retained four suites and 34 tests after N
    reached persistence-activity or core-store `$state` initializers. The
    unchanged batch passed in S and is owned by Phase 3 client-server
    promotion; Phase 2 has no remaining unprobed N candidate.
27. Phase 2 closed after 35 files and 176 tests moved from D to N, all 13
    remaining generated N mismatches received exact probe-backed owners, three
    warm ordinary frontend runs passed with a 69.50s wall median, and the final
    `test:all` rerun passed every lane. The 20% end-state wall target remains a
    workstream goal rather than a Phase 2 exit requirement.
28. Phase 3 began with seven suites and 69 tests whose exact Svelte+Node probes
    had already passed during Phase 2. Their durable prompt, character-card,
    hydration, asset, backup, bootstrap, and replacement-database contracts now
    run without Happy-DOM; no production or test-body boundary changed.
29. The complete target-S probe passed 34 of 127 candidates without Happy-DOM
    and gave exact blockers for 93. A smaller-runtime Node cross-check passed 28
    of those 34; Phase 3 routes Node-safe type-only and compiler-library imports
    to N instead of preserving the static classifier's false-positive S label.
30. The client state and command slice moved eleven suites / 123 tests to Node
    and two durable plugin-command suites / 34 tests to Svelte+Node. The latter
    fail in Node at `persistenceActivity.svelte.ts` `$state` initialization.
31. The process-state slice moved eleven suites / 119 tests to Node after both
    Svelte+Node and Node passed unchanged. Their store-runtime and type-only
    imports do not require a client transform, and no rendered consumer moved.
32. The server resource-projection slice moved six suites / 70 tests to Node
    and four suites / 46 tests to Svelte+Node. The S owners initialize real
    persistence, resource, or core-store `$state`; the N owners do not require
    client transformation despite their static S signals.
33. The generation-effect slice moved two suites / 10 tests to Svelte+Node.
    Phase 2 had proved their real persistence and core-store rune dependencies
    reject plain Node; Phase 3 proved the unchanged tests require no DOM.
34. The blocker ledger accounts for all 93 failed target-S probes: 91 unchanged
    graphs read `window`, and two suites execute real `DOMParser` behavior. The
    retained Happy-DOM scopes pass all 1,503 tests. Phase 4 stopping-gate triage
    owns measured import-graph seams; Phase 5 owns durable parser contracts.
35. Phase 3 closed after 43 files / 471 tests moved out of Happy-DOM, every
    remaining mismatch received target-project evidence, and the complete
    validation gate passed. The 68.47s warm wall median improves 5.3% from
    Phase 0 but misses the primary target; Phase 4 uses the new measured ranking.
    Svelte+Node remains useful and durable at 17 files / 167 tests.
36. Phase 4 began by extracting chat-import full-create and tail-chunk request
    planning into a plain TypeScript leaf. Six Node tests own the boundary and
    combinatorial matrix; the retained 183-test Happy-DOM suite still proves
    exact durable requests, the production 16 MiB limit, staging, terminal
    prefix rollback, and no-send rejection. The focused D test-body observation
    improved from 5.08s to 4.03s; phase-level measurement remains open.
37. The settings slice extracted Saved Toggles comparison, similarity, Pick
    eligibility/value projection, and active-key projection from the browser
    command graph. The suite expanded from five D tests to seven N tests; its
    focused runtime moved from 2.86s Vitest / 109ms environment to 169ms / no
    environment. The mounted sidebar remains the visible-state and persistence
    owner. Translator projection and picker candidates remain D-owned under
    recorded revisit conditions because their current proofs cross resource,
    receipt, focus, interaction, or rollback boundaries.
38. The server-backed fixture candidate was measured and rejected as a Phase 4
    extraction. Its 39 local cases execute real `sendChat` state/provider
    lifecycles, and its 27 server-backed cases execute authenticated Fastify,
    SQLite, browser-fetch, persistence, replay, and rollback boundaries. The
    deterministic-looking loader/snapshot helpers are test-only and have no
    production caller; moving them would add coverage without removing the
    expensive integration graph. Revisit only for a real shared production
    fixture protocol or a measured cross-suite Fastify lifecycle boundary.
39. The router slice assigned its existing plain TypeScript production leaf an
    eight-test Node matrix and removed five direct settings slug/path cases from
    the browser owner. The retained 32 Happy-DOM cases still own history,
    location, stores, guards, canonicalization, and freshness races. Focused D
    runtime was unchanged within noise, so the slice is retained for broader
    planner correctness and maintainable capability ownership, not claimed as
    a performance improvement.
40. Phase 4 closed after all four ranked candidate families received an
    implementation or explicit deferral and the complete eight-lane gate
    passed. The focused candidate sum improved 27.7%; the 70.10s ordinary warm
    median is +2.4% from Phase 3, inside run noise, and remains 3.0% below Phase
    0. Further extraction is stopped until fresh evidence demonstrates another
    production planner/reducer; repeated DOM harness cost transfers to Phase 5.

## Accepted Observations

The first Phase 0 `test:all` attempt saw the queued-finalization browser-smoke
case time out after observing six pending effects. Its exact isolated rerun and
the complete aggregate rerun passed. Owner: generation browser-smoke. Reason
for acceptance: no Phase 0 runtime/production path touched that contract and
the final required run passed. Revisit condition: any repeat in Phase 2 blocks
the active promotion slice until investigated.

The first Phase 1 complete DOM-project run reproduced the known display-source
batching instability. The first critical request was observed before its sibling;
that failed assertion left a deferred response unresolved and held the shared
revision lane, cascading into four later failures in the same file. Three exact
focused reruns passed all 8 tests, the complete 407-file DOM rerun passed, and
the later repeated frontend lanes passed. Owner: display-source batching. Reason
for acceptance: the topology slice did not touch that production/test path, the
failure matches the pre-existing observation, and focused plus complete reruns
passed. Revisit condition: another full-lane occurrence requires a dedicated
display-source batching stabilization decision before the active promotion
slice continues.

That revisit condition fired during the pre-change DOM baseline for the next
Phase 2 slice: the same-chat contract observed two one-target requests instead
of one two-target request. The dedicated stabilization now registers pending
batch preparation before asynchronous hashing and waits for sibling
preparations before scheduling the flush. Three focused 8-test reruns and the
complete 386-file DOM project passed. The blocker is resolved; any further
occurrence reopens the display-source batching owner before another promotion.

The first Phase 2 exit `test:all` attempt saw the two-concurrent-chat browser
journey receive a `revision_conflict` while preparing chat generation settings.
Its exact isolated rerun passed, and the complete aggregate rerun passed all 34
browser-smoke cases and every other required lane. Owner: accepted-send browser
smoke. Reason for acceptance: Phase 2 changed only test ownership and
documentation, the failure occurred in browser-fixture setup, and both focused
and final aggregate evidence passed. Revisit condition: another occurrence
requires a dedicated setup-revision stabilization decision before Phase 3
promotion continues.

## Latest Completed Slice

[Phase 4 closeout and re-profile](phases/slices/phase-4/closeout-and-reprofile.md)
completed the full validation gate, formal benchmark, cumulative performance
accounting, and stopping decision.

## Latest Verification

See [`latest-verification.md`](latest-verification.md) for current Phase 4 slice
measurements and discovery totals, the Phase 3 formal benchmark, and preceding
promotion and probe records.

## Maintenance Rules

- Update this file whenever a phase or slice changes state.
- Keep this file a router, not a chronological implementation diary.
- Put stable scope and invariants in `plan.md`.
- Put phase scope and exit criteria under `phases/`.
- Add concrete implementation/proof slices under `phases/slices/<phase>/` only
  when that phase is prepared for execution.
- Record exact commands and results in `latest-verification.md`.
- Record deferrals with an owner, reason, and revisit condition.
- Do not mark a phase complete until its exit criteria and focused validation
  pass or an exact accepted gap is recorded here.
