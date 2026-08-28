# Phase 5 Slice: Closeout And Re-Profile

Status: Complete

## Scope

Close Phase 5 after every profile-selected consolidation and source-policy
follow-up has landed. Prove final Happy-DOM ownership, run the formal cold and
three-warm benchmark, execute independent projects and the complete eight-lane
gate, and record the residual DOM-owner stopping decision.

No production behavior, runtime topology, isolation policy, coverage threshold,
or CI configuration changes in this closeout slice.

## Ownership And Completeness

Phase 5 completed four implementation slices:

- two Toggles audit files became one three-case DOM owner;
- three AlertComp files became one 15-case real-component owner;
- two provider-control files became one four-case owner with real inputs; and
- 29 source-policy checks left seven mixed D owners for one explicit Node
  architecture gate while all 368 behavioral cases stayed in Happy-DOM.

The final full universe is 536 files at 193 N / 17 S / 326 D. Standalone
ordinary is 534 files at 193 N / 17 S / 324 D, and aggregate ordinary is 528
files / 6,423 tests at 192 N / 17 S / 319 D. Relative to the Phase 5 baseline,
four D boundaries were removed and one explicit N owner was added: net -3
files, with no test removed.

Every remaining D owner has an explicit reason. The final 326-file accounting
is 230 direct mounted/DOM/browser owners, 91 exact target-S eager-window
retainers, two real-DOMParser contracts, and three exact target-N browser
retainers. Source-file reads remaining in D execute service-worker behavior in
a VM or consume recorded fixture data; no incidental source-policy assertion
remains mixed into a D behavior owner.

## Focused Consolidation Result

| Family | Files | Tests | Import before -> after | Environment before -> after | Wall before -> after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Toggles | 2 -> 1 | 3 | 23.28s -> 10.26s | 349ms -> 123ms | 13.17s -> 11.48s |
| AlertComp | 3 -> 1 | 15 | 29.18s -> 9.74s | 365ms -> 138ms | 11.10s -> 11.20s |
| Provider controls | 2 -> 1 | 4 | 13.95s -> 7.05s | 237ms -> 116ms | 8.03s -> 8.20s |

Across the three coherent families, import sum falls from 66.41s to 27.05s
(59.3%) and environment sum from 951ms to 377ms (60.4%). Sequential focused
wall falls from 32.30s to 30.88s (4.4%). Each family and the static gate passed
shuffled test-order runs with seeds 101, 202, and 303, retries disabled.

The source-policy transfer preserves 397 focused contracts as 368 D plus 29 N.
Its focused wall moved from 14.27s to 13.93s and peak RSS from 2,283,868 to
2,279,492 KiB, both inside noise; the Node gate itself has 0ms environment
setup.

## Formal Performance Result

The transform-cache-cleared cold run passed 528 files / 6,423 tests in 69.56s
wall and 68.60s Vitest duration, with 4,902,684 KiB peak RSS.

Three consecutive warm runs passed the same 528 files / 6,423 tests:

| Run | Wall | Vitest | User | System | CPU | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 69.62s | 68.58s | 403.28s | 31.26s | 624% | 5,023,792 |
| 2 | 68.55s | 67.68s | 415.00s | 28.09s | 646% | 4,769,088 |
| 3 | 66.61s | 65.63s | 389.80s | 31.88s | 633% | 4,648,996 |
| Median | 68.55s | 67.68s | 403.28s | 31.26s | 633% | 4,769,088 |

The wall range is 66.61-69.62s. Against Phase 4, wall median improves 1.55s
(2.2%) and peak-RSS median improves 124,552 KiB (2.5%). Against Phase 0, wall
median improves 3.75s (5.2%) and peak RSS improves 16,200 KiB (0.3%). The
57.84s primary and 50.61s stretch targets remain unmet.

Median aggregate worker phases are 102.11s transform, 28.16s setup, 396.89s
import, 79.75s test bodies, and 41.06s environment. These parallel worker sums
do not add to wall time. Relative to Phase 4, median import falls 2.3% and
environment falls 5.4%; the whole-lane wall change remains inside the
established 5% noise band, so the stronger performance evidence is the focused
repeated-graph reduction.

## Validation Result

- Independent Node passed 193 files / 1,314 tests in 4.41s Vitest; Svelte+Node
  passed 17 files / 167 tests in 1.78s; standalone Happy-DOM passed 324 files /
  5,145 tests in 64.49s.
- Focused UI coverage passed 6 files / 203 tests in 18.81s Vitest and 19.79s
  wall with all thresholds satisfied.
- The Phase 5 affected dry-run selected frontend, performance, and server
  lanes. The aggregate still exercised the unaffected browser-smoke lane.
- `pnpm test:all --dry-run` showed the expected eight-lane graph.
- `pnpm test:all` passed in 3m22.2s: 528 frontend files / 6,423 tests, 154
  server files / 3,295 passing tests with one skip, all 34 browser-smoke cases,
  6 UI coverage files / 203 tests, and 2 performance files / 6 tests.
- Frontend and server/browser-smoke type checks had zero errors or warnings.
  Formatting, inventory completeness, and `git diff --check` passed.

## Intentional Residual Owners

The final profile does not justify more Phase 5 merging:

- `chatCommands.test.ts`, `bootstrap.test.ts`, `plugins.test.ts`, translator
  settings, chat-generation settings, picker settings, and the two send-chat
  fixture suites are cohesive mega-suites around distinct command, bootstrap,
  plugin, settings, picker, Fastify, persistence, and fixture lifecycles.
- DefaultChatScreen load-pages and shell-greeting owners keep separate UI-map
  coordination and bootstrap/resource graphs.
- Hypa reset-race, server-reliability, and summary-item owners retain distinct
  async-ownership and component mock graphs.
- Chat custom-HTML/parser owners and Bookmark hydration/resource-guard owners
  retain different real-component and test-double boundaries.

Revisit only with new scheduling evidence or a genuinely shared production
lifecycle seam. Merging these owners by size alone would obscure ownership or
add a larger coupled harness.

## Stopping Decision

Phase 5 stops. Every D owner is accounted for, all selected repeated harnesses
have one coherent owner, the exceptional source-policy style is explicit, and
the full validation gate is green. Phase 6 owns suffix-default inversion,
legacy inventory retirement, affected/aggregate alignment, and CI enforcement.

## Rollback

The closeout itself adds no runtime change. Each implementation slice has an
independent rollback; replace this benchmark only with a complete newer
same-host profile.
