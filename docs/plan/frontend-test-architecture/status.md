# Frontend Test Architecture Status

Date: 2026-08-28

This is the live router for the frontend test runtime architecture workstream.
Use it first, then open only the active phase or slice. The current runner and
codebase remain authoritative until a phase lands.

## Current Snapshot

- Plan state: Phases 0-1 complete; Phase 2 in progress.
- Current phase: Phase 2 — Pure Node Promotion.
- Active slice: No implementation slice is active; the character-card PNG
  import Node proof is complete without promotion.
- Implementation state: Thirty-two files and 156 tests have moved from the
  Happy-DOM fallback to Node across eleven bounded slices with no production
  changes.
- Blockers: None.
- Next action: Prepare the bounded Phase 2 prompt-toggle durability Node probe.
  Retain the five completed Node-probe deferrals under their recorded owners.

## Phase Router

| Phase | State | Purpose |
| --- | --- | --- |
| [0](phases/phase-0-baseline-and-classification.md) | Complete | Ratified metrics, capability rules, and discovery/completeness proof. |
| [1](phases/phase-1-runtime-topology.md) | Complete | Added and piloted the Node, Svelte+Node, and Happy-DOM topology. |
| [2](phases/phase-2-pure-node-promotion.md) | In progress | Promote already-pure tests to Node in bounded domain slices. |
| [3](phases/phase-3-svelte-node-promotion.md) | Pending | Promote Svelte-compiled tests that do not require DOM behavior. |
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
| Completed slices and proof batches | 13 |
| Promoted suites | 32 files / 156 tests |
| Full three-project universe | 537 files: 158 N / 2 S / 377 D |
| Standalone ordinary frontend | 535 files: 158 N / 2 S / 375 D |
| `test:all` ordinary frontend | 529 files / 6,413 tests: 157 N / 2 S / 370 D |
| Remaining target-runtime mismatches | 143: 16 N / 127 S |
| Latest paired ordinary wall observation | 69.11s -> 68.57s (-0.8%) |
| Latest paired ordinary peak RSS | 4,999,492 -> 4,751,748 KiB |

The paired timing is slice evidence, not a phase-level median. The -0.8% wall
movement remains inside ordinary run-to-run variability; it is not a
phase-level performance claim. Phase 2 remains open for 11 unprobed N
candidates. The generated inventory also counts the probed character-card,
hydration-read, and two generation-effect suites plus the probed device-backup
suite retained in D.

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

## Latest Completed Slice

[Phase 2 character-card PNG import Node probe](phases/slices/phase-2/character-card-png-import-node-probe.md)
retained the 21-test import/export suite in Happy-DOM after proving its
transitive Svelte rune requirement in Node and its no-DOM compatibility in
Svelte+Node. No production, test-body, setup, or permanent ownership change
landed.

## Latest Verification

See [`latest-verification.md`](latest-verification.md) for the latest Phase 2
current-owner, Node, and Svelte+Node probe evidence plus unchanged discovery
and validation, followed by the preceding promotion, proof, and retained Phase
1 closeout records.

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
