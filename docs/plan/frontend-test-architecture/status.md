# Frontend Test Architecture Status

Date: 2026-08-28

This is the live router for the frontend test runtime architecture workstream.
Use it first, then open only the active phase or slice. The current runner and
codebase remain authoritative until a phase lands.

## Current Snapshot

- Plan state: Phases 0-2 complete; Phase 3 in progress.
- Current phase: Phase 3 — Svelte+Node Promotion (in progress).
- Active slice: Prepare the next bounded target-S probe batch after the
  proof-backed runtime-bridge promotion.
- Implementation state: Phase 3 has moved seven files and 69 tests from
  Happy-DOM to Svelte+Node without production or test-body changes. Phases 2-3
  have promoted 42 files and 245 tests in total.
- Blockers: None.
- Next action: Probe the remaining Phase 0 target-S candidates in bounded
  domain slices and record exact blockers for any real DOM/browser dependency.

## Phase Router

| Phase | State | Purpose |
| --- | --- | --- |
| [0](phases/phase-0-baseline-and-classification.md) | Complete | Ratified metrics, capability rules, and discovery/completeness proof. |
| [1](phases/phase-1-runtime-topology.md) | Complete | Added and piloted the Node, Svelte+Node, and Happy-DOM topology. |
| [2](phases/phase-2-pure-node-promotion.md) | Complete | Promoted already-pure tests to Node and recorded every retained N candidate. |
| [3](phases/phase-3-svelte-node-promotion.md) | In Progress | Promote Svelte-compiled tests that do not require DOM behavior. |
| [4](phases/phase-4-pure-logic-extraction.md) | Pending | Extract measured pure-logic seams while retaining DOM contracts. |
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

## Phase 3 Current Result

| Measurement | Result |
| --- | ---: |
| Completed slices | 1 |
| Promoted suites | 7 files / 69 tests |
| Full three-project universe | 537 files: 161 N / 9 S / 367 D |
| Standalone ordinary frontend | 535 files: 161 N / 9 S / 365 D |
| `test:all` ordinary frontend | 529 files: 160 N / 9 S / 360 D |
| Remaining target-runtime probes | 133 |
| Focused Happy-DOM environment time | 1.35s |
| Focused Svelte+Node environment time | 170ms |

The first slice promoted only suites with exact Phase 2 Svelte+Node evidence.
Its combined focused wall observation moved from 2.52s to 1.97s and peak RSS
from 939,396 KiB to 785,804 KiB. These are capability and mechanism observations,
not the formal Phase 3 performance result; the stopping-gate benchmark remains
pending until every target-S candidate is promoted or blocked.

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

[Phase 2 server resource and bootstrap Node probe](phases/slices/phase-2/server-resource-and-bootstrap-node-probe.md)
retained four suites and 34 tests in Happy-DOM after proving their transitive
Svelte rune requirements in Node and their no-DOM compatibility in
Svelte+Node. All Phase 2 N candidates now have target-runtime evidence.

## Latest Verification

See [`latest-verification.md`](latest-verification.md) for the current Phase 3
slice evidence, the Phase 2 three-run timing gate, final aggregate validation,
accepted browser-smoke observation, and preceding promotion and probe records.

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
