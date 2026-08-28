# Phase 5 Slice: Baseline And Candidate Profile

Status: Complete

## Scope

Begin Phase 5 with a clean-tree profile of the ordinary Happy-DOM project,
account for every D-owned file, measure coherent repeated-import families, and
select bounded implementation slices. This slice changes documentation only;
it does not change runtime routing, tests, production code, or isolation.

## Environment And Source State

- Repository: `/home/codex/risuai-fastify`
- Base commit: `32042205a`
- Node: 24.19.0
- pnpm: 11.23.0
- Vitest: 4.1.2
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`
- Isolation: enabled

The checked inventory passed before measurement. Full discovery is 539 files
at 192 N / 17 S / 330 D, standalone ordinary is 537 files at 192 N / 17 S /
328 D, and aggregate ordinary is 531 files at 191 N / 17 S / 323 D.

## Happy-DOM Ownership Accounting

Every one of the 330 full-discovery D owners has an explicit reason:

| Owner class | Files | D reason |
| --- | ---: | --- |
| Direct D classifier | 234 | Mounted component, DOM traversal/event/focus behavior, browser storage/API behavior, or a DOM-owned gate is directly visible in the file. |
| Retained target-S browser graph | 91 | The exact Phase 3 probe reaches an eager `window` dependency; the unchanged subject graph is therefore browser-owned. |
| Retained target-S parser contract | 2 | `multisend.test.ts` and `translator.html.test.ts` exercise real `DOMParser`, parsed-document traversal, and extracted content. |
| Retained target-N browser contract | 3 | `pluginIconSafety.test.ts` exercises real DOMPurify sanitization, `internalClients.test.ts` exercises the window-owned directory picker, and `storage/backup.test.ts` exercises `HTMLInputElement` file picking. |

The per-file source anchors remain in `phase-0-inventory.tsv`. The exact 93
target-S failures and revisit conditions remain in the Phase 3 blocker ledger;
the three target-N failures remain in their Phase 2 proof slices. No current D
owner is unaccounted for or pending a new runtime probe.

## Current Profile

The ordinary D project with the six separately owned UI-map files and two
explicit performance gates excluded passed 323 files / 4,976 tests. Vitest
duration was 61.46s; measured wall was 62.30s, CPU was 627%, and peak RSS was
4,707,148 KiB. Worker-phase sums were 94.23s transform, 17.06s setup, 387.39s
import, 75.30s tests, and 41.79s environment.

The ranking still places the broad chat, settings, bootstrap, plugin, fixture,
and persistence owners at the top. They do not satisfy the Phase 5 merge rule:
they have different production graphs or are already cohesive mega-suites.
Splitting them would add environment/import cost without current scheduling
evidence. This phase therefore targets repeated small-file ownership instead.

## Selected Consolidation Families

| Family | Before | Vitest | Import sum | Environment sum | Wall | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Toggles audit gates | 2 files / 3 tests | 12.14s | 23.28s | 349ms | 13.17s | 1,452,164 |
| AlertComp contracts | 3 files / 15 tests | 10.15s | 29.18s | 365ms | 11.10s | 1,812,376 |
| Ooba/provider controls | 2 files / 4 tests | 7.32s | 13.95s | 237ms | 8.03s | 1,142,032 |

The Toggles pair imports the same component and mocked command/settings graph,
uses the same mount and cleanup lifecycle, and protects adjacent grouped and
optimistic visible-paint behavior. The AlertComp family imports the same modal
graph and repeats target/mount/store cleanup across branch, request-data,
translation-race, input, select, and confirmation contracts. The provider pair
uses the same Ooba component, control stubs, and target lifecycle; its
OpenRouter behaviors remain a separate describe under the same provider-control
owner.

Each implementation keeps independent `beforeEach` state, deterministic
unmount/removal, and every visible DOM/focus/race assertion. Focused before and
after measurements establish the local import/environment mechanism; the
formal closeout establishes project and ordinary-lane impact.

## Source-String Review

The D inventory contains two non-policy file reads: recorded send-chat fixture
data and executing the service worker in a VM. Neither is a source-string
assertion. Seven D suites contain source-policy assertions mixed into broader
behavior owners. Phase 5 will move those assertions to one explicitly labeled
Node static-architecture gate while leaving their mounted, durability, race,
rollback, and visible-state assertions with their existing owners. This makes
the exceptional assertion style discoverable without claiming source text is
visible behavior.

## Intentional Non-Candidates

- `DefaultChatScreen.loadPages.test.ts` remains the UI-map-owned coordinator;
  its shell-greeting companion has a different bootstrap/resource harness.
- The two HypaV3 modal suites retain separate legacy async-ownership and server
  reliability mock graphs; merging them would create a less readable mega-suite.
- Chat custom-HTML and parser-dependency suites retain different real-component
  and purpose-built harness owners.
- Bookmark hydration and resource-guard paths retain different real/test-double
  boundaries.
- The broad chat-generation settings, translator settings, picker, bootstrap,
  plugin, and fixture suites remain cohesive residual mega-suites. Revisit only
  with new scheduling evidence or a genuinely shared production lifecycle seam.

## Validation

- `pnpm check:frontend-test-inventory`
- ordinary `frontend-dom` current profile
- focused current-source runs for all three selected families
- `git diff --check`

All commands passed. Exact measurements are also recorded in
`latest-verification.md`.

## Rollback

Revert this record if a newer clean-tree profile changes the selected families.
Each implementation slice has its own rollback and does not depend on changing
the global runtime topology.
