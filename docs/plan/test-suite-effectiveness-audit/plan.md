# Test Suite Effectiveness Audit Plan

Date: 2026-08-29

## Goal

Establish whether the complete test system protects the defects that matter,
remove false confidence and unjustified maintenance cost, and leave every
retained test with a clear contract and evidence role.

This is both an audit and a controlled remediation workstream. Domain phases may
strengthen, merge, reclassify, or remove tests when their evidence package is
complete. Production defects uncovered by the audit require separate focused
fixes with regression proof; they must not be hidden inside test cleanup.

[`status.md`](status.md) is the live execution router. This file owns stable
scope, taxonomy, value rules, invariants, phase order, and acceptance gates.

## Why This Requires A Workstream

The planning baseline contains 698 tracked test/spec files, three frontend
Vitest capabilities, a separate Fastify lane, seven stateful Chromium specs,
special performance and UI coverage owners, and an opt-in compatibility harness
with a pinned external worktree and tracked goldens. Several important product
contracts are intentionally defended at more than one layer.

Simple cleanup heuristics are unsafe:

- file count does not reflect parameterized matrices, mega-suite complexity, or
  shared harness cost;
- coverage says code executed, not that assertions detect a realistic defect;
- similar assertions may be valuable defense in depth across storage, API, DOM,
  and browser boundaries;
- source or architecture-policy tests can be brittle yet still enforce an
  important dependency, security, or ownership rule;
- a flaky or slow test may protect a unique race, deadline, scale, or recovery
  contract;
- deleting a frontend or server test widens affected-test execution and can also
  require routing, coverage-owner, fixture, helper, golden, or screenshot
  cleanup.

The work therefore needs an exhaustive inventory, repeatable decisions,
category ownership, explicit removal safeguards, and phase-level verification.

## Authority And Boundary Sources

- `package.json` owns user-facing test, coverage, smoke, and aggregate commands.
- `vitest.config.ts`, the three frontend project configs, and
  `vitest.frontend-routing.ts` own frontend discovery and runtime routing.
- `server/fastify/vitest.config.ts` owns Fastify test discovery.
- `playwright.fastify-smoke.config.ts` owns built-browser discovery and runtime.
- `vitest.ui-coverage-tests.ts` and `vitest.performance-tests.ts` own their
  specialized inventories.
- `util/frontend-test-inventory.ts` owns exhaustive frontend routing proof.
- `util/affected-tests.ts` owns changed/deleted-file selection and widening.
- `util/test-all.ts` owns aggregate ordering, dependencies, and isolation.
- `.github/workflows/quality.yml` owns CI lane parity.
- `test/compat-harness/` owns the opt-in baseline/current golden comparison.
- `docs/structure/testing-and-operations.md` and `docs/tests/` describe the
  current system and remain authoritative until accepted changes land.
- Production behavior and current runner discovery win when inventories or
  historical counts drift.

## Primary Audit Taxonomy

Every tracked test receives exactly one primary category. Cross-domain behavior
is represented with companion tags and seam notes, not duplicate full reviews.

| ID  | Primary category                                             | Main boundaries                                                          |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| A   | Assurance architecture and special lanes                     | Runners, setup, inventory, affected selection, CI, fixtures, gates, compatibility. |
| B   | Browser state synchronization and recovery                   | Bootstrap, writer/observer, outbox, replay, hydration, invalidation.     |
| C   | Persistence, commands, events, and editing bridges            | SQLite, revisions, receipts, message storage, optimistic rollback.       |
| D   | App navigation, chat, shared UI, feedback, and accessibility  | Routes, sidebars, composer, transcript, focus, responsive behavior.      |
| E   | Settings, profiles, content authoring, and catalogs           | Settings, personas, characters, lorebooks, Realm, reordering, uploads.   |
| F   | Prompting, generation, and streaming                          | Assembly, templates, SSE, cancel, reattach, finalization, Agent Presets. |
| G   | Providers, models, credentials, translation, and media        | Adapter conformance, secrets, capabilities, image/audio/transcription.   |
| H   | Memory, embeddings, summaries, jobs, and workers              | Planning, ranking, transitions, retries, cancellation, reconciliation.   |
| I   | Scripting, parsing, triggers, Lua, and automation             | CBS, regex, display transforms, execution bounds, cache invalidation.    |
| J   | Plugins, modules, MCP, Playground, and specialized tools      | Permissions, sandboxing, OAuth/tools, lifecycle, developer surfaces.     |
| K   | Assets, imports, exports, saves, and backups                  | Hashing, GC, codecs, bounded staging, restore, historical formats.       |
| L   | API security, runtime, limits, tracing, and operations        | Auth, route protection, SSRF, budgets, startup/shutdown, Web Push.       |

Boundary assignment rules:

- visible chat interaction belongs to D; model-visible assembly and transport
  semantics belong to F;
- settings UI belongs to E; provider credential and wire behavior belongs to G;
- Realm/catalog interaction belongs to E; import bytes, atomicity, and salvage
  belong to K;
- plugin/module authoring UI belongs to E; permission, execution, and lifecycle
  behavior belongs to J;
- browser specs receive the product category for the behavior they prove while
  their harness, isolation, and flake properties are reviewed horizontally in A.

## Secondary Classification

Each inventory row records:

- file path and stable production owner/symbol;
- primary category and cross-domain seam tags;
- execution lane and capability: frontend N/S/D, Fastify Node, built-browser B,
  compatibility, performance, static policy, or support artifact;
- test kind: pure unit, component/DOM, storage integration, API integration,
  browser journey, golden/compatibility, property/fuzz, performance/budget, or
  architecture policy;
- value class and protected failure mode;
- overlapping or companion evidence at other layers;
- risk if the contract regresses;
- decision, rationale, finding ID, action owner, validation, and state.

The Phase 0 inventory may extend this schema, but it must remain machine-readable
and independently checkable against runner and filesystem discovery.

## Value Classes

A retained test must protect at least one of these intentional values:

1. **User-visible behavior:** a real interaction, visible state, accessibility,
   focus, navigation, or responsive outcome.
2. **Data integrity and recovery:** durable writes, atomicity, identity,
   ordering, replay, rollback, migration, or no-data-loss behavior.
3. **Protocol and integration:** request/response shape, SSE vocabulary,
   provider conformance, storage layout, or cross-layer ownership.
4. **Security and safety:** authentication, authorization, secret handling,
   egress restrictions, untrusted input, budgets, or cleanup.
5. **Compatibility:** a deliberately supported historical format or upstream
   behavior with a named support boundary.
6. **Architecture policy:** an intentional dependency, routing, ownership, or
   source boundary that cannot be enforced more directly by types or tooling.
7. **Performance and capacity:** a measured cost, scale, cache, deadline,
   backpressure, read/write, render, or memory budget.
8. **Diagnostic oracle:** a shared assertion helper or harness whose own
   correctness materially raises confidence in dependent tests.

Documentation value by itself is not enough. The test must fail when its named
contract is meaningfully violated.

## Effectiveness Rubric

Review each test or cohesive matrix against all questions below. Record evidence
rather than a numeric score; no decision is made by score alone.

### Contract

- Can the reviewer name the exact defect or invariant this test protects?
- Is that contract still supported by current production behavior and docs?
- Does the assertion observe the contract rather than incidental setup or a mock
  that merely repeats the implementation?

### Defect Sensitivity

- Would a plausible fault in the production owner make the test fail for the
  intended reason?
- Where doubt exists, can a temporary mutation, fault injection, or controlled
  counterexample demonstrate sensitivity?
- Does the test fail if the behavior is omitted, reordered, broadened, leaked,
  or applied to the wrong stable target?

### Evidence Layer And Realism

- Is Node, Svelte+Node, Happy-DOM, Fastify, Chromium, or the compatibility
  harness the smallest faithful layer for this contract?
- Do mocks isolate unrelated dependencies while preserving the behavior under
  test, or do they make the result self-fulfilling?
- Is a lower-layer exact contract paired with visible or cross-layer proof where
  user-observable semantics require it?

### Distinctiveness

- Does another test catch the same failure mode with equal or stronger evidence?
- If behavior appears duplicated, do the tests protect different boundaries or
  failure causes and therefore provide useful defense in depth?
- Can repeated setup or parameter rows be consolidated without losing a named
  scenario, target, boundary, or diagnostic signal?

### Stability And Cost

- Is state reset deterministic and independent of execution order?
- Are timers, retries, network, files, global mocks, and shared fixtures bounded
  and cleaned up?
- Is maintenance or runtime cost proportionate to the protected risk, or can the
  same evidence be obtained more simply without weakening it?

## Candidate Signals For Tests Without Meaningful Value

These are triage signals, not automatic deletion rules:

- asserts only that a function was called, a component mounted, an import
  succeeded, or a mock returned its configured value;
- checks an implementation string, markup detail, constant, passthrough, or
  default already enforced more directly, without naming an architectural
  policy or realistic failure;
- duplicates the same scenario, layer, assertion, and failure mode with no
  independent boundary value;
- exercises obsolete or unreachable behavior outside an explicit compatibility
  promise;
- uses snapshots or broad object equality whose meaningful signal is unclear or
  routinely refreshed without semantic review;
- mocks the subject or behavior-defining dependency so completely that the test
  can stay green when production is broken;
- has no identifiable production owner, supported contract, plausible defect,
  or consumer;
- costs substantial maintenance or execution time while a smaller, stronger
  contract already provides equivalent evidence.

Narrow mapping, static-policy, oracle, and implementation-aware tests are not
automatically low value. They remain when the enforced boundary is intentional,
important, and not better guaranteed elsewhere.

## Decisions

- **Keep:** distinct valuable contract at a faithful layer; no action required.
- **Strengthen:** valuable intent, but assertions, realism, cases, or layer are
  insufficient.
- **Merge:** equivalent failure mode can move into a stronger cohesive owner;
  remove the weaker owner only in the same validated change.
- **Reclassify:** valuable test belongs to another category, runtime, lane, or
  explicit policy/gate designation.
- **Remove:** no meaningful unique value remains after the complete removal
  proof.
- **Add:** a material contract is unprotected and requires new evidence.
- **Defer:** evidence or authority is insufficient; record an owner, reason, and
  concrete revisit condition.

Flakiness triggers Strengthen or Reclassify before Remove. Slowness triggers
measurement and possible gate/schedule changes before Remove. Low coverage is a
discovery signal, not an Add decision by itself.

## Removal And Consolidation Proof

Before deleting a test or collapsing a scenario, the slice must:

1. Name the production contract and plausible failure mode previously claimed
   by the test.
2. Demonstrate that the contract is obsolete, unreachable, valueless, or
   equivalently protected by a named stronger test. Coverage percentage alone
   is not proof.
3. Explain why apparent defense in depth is not useful across unit, storage,
   API, DOM, browser, compatibility, security, or performance boundaries.
4. Use counterfactual evidence when the decision is ambiguous: a controlled
   mutation, fault injection, historical defect, or comparison showing that the
   candidate adds no defect sensitivity.
5. Search for imports and consumers of shared mocks, fixtures, helpers, setup,
   goldens, snapshots, and test-only exports; remove only artifacts made
   genuinely orphaned.
6. Update frontend routing registrations, capability inventory, UI coverage
   ownership, performance ownership, affected routing, compatibility goldens,
   and docs when the removed owner participates in them.
7. Run `pnpm test:affected --dry-run` for the deletion and every selected lane.
   Deleted frontend/server tests require the complete owning lane.
8. Run category-specific gates: UI coverage and browser smoke for visible
   behavior, isolated performance gates for cost contracts, compatibility for
   generation/prompt parity, and screenshot review for visual baselines.
9. Record the decision, evidence, count delta, and validation permanently in the
   finding ledger and latest verification record.

Do not refresh a golden, snapshot, or fixture merely to make a removal pass.
Any update must be intentional and reviewed as its own semantic change.

## Finding Severity

- **Critical:** false confidence or missing proof around data loss, credential or
  authorization exposure, destructive restore/import, or unrecoverable durable
  generation behavior.
- **High:** a plausible important defect is unprotected, or a test materially
  misrepresents a high-risk production boundary.
- **Medium:** weak, duplicated, flaky, or over-mocked evidence creates notable
  maintenance cost or a meaningful blind spot.
- **Low:** localized clarity, organization, diagnostic, or low-risk contract
  improvement.
- **Informational:** valid retained coverage, intentional defense in depth, or a
  documented non-action with useful reasoning.

Severity measures product/audit risk, not implementation effort.

## Invariants

### Coverage And Discovery

- Every tracked test remains discovered exactly where current routing says it
  belongs until an accepted change lands.
- Every removal and case-count delta is intentional, recorded, and validated.
- UI coverage sentinels, performance tests, browser specs, compatibility
  artifacts, and direct-only stress cases cannot disappear through ordinary
  discovery assumptions.
- Broad coverage reports inform investigation but do not substitute for defect
  sensitivity or impose an arbitrary suite-wide percentage target.

### Behavioral Fidelity

- Do not replace visible outcomes with internal assertions, real persistence
  with object-shape mocks, or real boundary semantics with self-fulfilling fakes.
- Preserve stable-target, race, cancellation, replay, rollback, accessibility,
  cleanup, security, compatibility, and scale semantics when consolidating.
- A production defect found during the audit receives a regression test that
  would have caught it before the fix.

### Independence And Reproducibility

- Per-file isolation remains the default.
- Fixed sleeps must be replaced with observable barriers when practical; do not
  delete a race test merely because its synchronization is poor.
- No unmocked external network or secret-bearing live canary enters required CI.
- Record the commit, toolchain, environment, command, count, duration, and
  relevant artifacts for phase-level claims.

### Honest Accounting

- Do not count a moved assertion as new coverage or a deleted duplicate as a
  quality improvement without explaining its failure-mode equivalence.
- Keep test files, test cases, production coverage, and protected-contract counts
  separate.
- Preserve red attempts that change the audit decision or expose a harness flaw.

## Work Units And Slice Rules

- One slice audits or remediates one cohesive product boundary or test family.
- Aim for roughly 40-70 ordinary files per audit batch, but split mega-suites,
  browser journeys, goldens, and shared harnesses by complexity rather than file
  count.
- A slice records exact files, production owners, category/seam tags, contract
  inventory, rubric evidence, findings, decisions, actions, count delta,
  validation, and rollback.
- Audit and remediation may share a slice only when the evidence is complete and
  the change is narrow. Otherwise land the finding before implementation.
- Update `status.md`, the inventory, the finding ledger, and
  `latest-verification.md` whenever a slice or phase changes state.

## Phase Overview

- [Phase 0](phases/phase-0-baseline-inventory-and-rubric.md) freezes the
  baseline, inventory, rubric, finding schema, and representative pilot.
- [Phase 1](phases/phase-1-assurance-architecture-and-special-lanes.md) audits
  runners, setup, discovery, CI, fixtures, helpers, compatibility, and gates.
- [Phases 2-12](phases/README.md) audit the eleven product-risk categories in
  dependency-aware order.
- [Phase 13](phases/phase-13-cross-suite-consolidation-and-remediation.md)
  resolves cross-category duplication, shared harness work, pending removals,
  parity contracts, and material gaps.
- [Phase 14](phases/phase-14-verification-and-closeout.md) proves final counts,
  effectiveness decisions, quality lanes, documentation, and archive handoff.

## Decision And Stopping Gates

### Before Phase 1

The inventory must be exhaustive, current counts reproducible, the rubric
ratified on representative tests, and removal proof accepted. Do not begin bulk
review with ambiguous categories or a score-only model.

### Before A Domain Phase Closes

Every in-scope test must have a disposition. All Critical/High findings must be
fixed, explicitly routed to a later dependency phase, or deferred with owner,
reason, and revisit condition. Every removal must pass its proof package.

### Before Phase 13

All domain inventories must be complete. Cross-category duplicates and shared
contract gaps must have named owners; Phase 13 must not become a second
unbounded audit.

### Before Phase 14

No unowned Pending decision may remain. All count deltas, accepted gaps,
compatibility changes, specialized gate changes, and current-doc changes must be
recorded.

## Not In This Plan

- Reducing test count, runtime, or coverage denominator as an objective.
- Deleting tests solely because they are narrow, duplicated in another layer,
  flaky, slow, implementation-aware, or currently green.
- Rewriting production architecture merely to make tests simpler without a
  separately justified product change.
- Replacing Vitest, Happy-DOM, Playwright, or the compatibility harness without
  an evidence-backed phase decision.
- Adding required live provider, media, Push, or network canaries that depend on
  secrets, cost, or unstable external availability.
- Treating archived counts, old line numbers, or historical audit conclusions as
  current authority.

## Execution Cursor

Phase 0 is complete. The frozen 698-file anchor, live 699-file inventory,
support universe, formal baseline, and representative rubric pilot are recorded
in the Phase 0 slice. Phase 1 is ready to begin with frontend discovery,
capability routing, and live-manifest assurance; no removal has been approved.
