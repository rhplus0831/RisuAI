# Original RisuAI Behavioral Compatibility Audit Plan

Date: 2026-08-30

## Goal

Systematically establish whether every retained shared RisuAI feature preserves
the user-observable behavior that this Fastify migration promises, distinguish
verified parity from signed product differences and unsupported surfaces, fix
confirmed regressions with durable evidence, and leave repeatable compatibility
gates that prevent the same omission classes from returning.

This is both an audit and a controlled remediation workstream. Domain phases may
add structural completeness checks, differential fixtures, fault seams, browser
journeys, or narrowly scoped production fixes when the finding and expected
behavior are fully verified. Broader production changes require a focused slice
with an explicit compatibility decision and regression proof.

[`status.md`](status.md) is the live execution router. This file owns stable
scope, cursor semantics, compatibility rules, taxonomy, evidence requirements,
phase order, and stopping gates.

## Reference Model

The audit uses three distinct references. They must never be collapsed into one
generic "Original RisuAI" cursor.

| Reference | Commit | Meaning |
| --- | --- | --- |
| Compatibility baseline | `71c476e9c86263fe907105b011ca4dde0a619d66` | Immutable Git fork point. Retained shared behavior must match this source unless a specific divergence is signed. |
| Behavioral sync cursor | `f3f0242fba297d82e0efcc2c31ca1428569b70f2` | Latest upstream commit whose changes were fully dispositioned and, where applicable, natively ported. It is not a source-equivalent ancestor or automatic parity proof. |
| Planning audit anchor | `1933c43ff7b4d35b57b0852013d95f3881a8cb28` | Fastify repository state that opened this workstream and recorded the cursor distinction. Later implementation cursors belong in `status.md`. |

The moving checkout at `/home/codex/Risuai` may be used to inspect post-fork
upstream intent. It is not the compatibility baseline. Fork-point differential
claims must use a detached worktree at the exact compatibility-baseline commit.

## Compatibility Bar

User-observable behavior of a retained shared feature matches the compatibility
baseline unless one of these conditions is recorded:

1. a specific user-visible divergence has an individual maintainer sign-off;
2. a feature is explicitly unsupported or no-port, is hidden or visibly
   diagnosed, and has a recorded support boundary;
3. a post-fork upstream behavior through the behavioral sync cursor has a
   recorded disposition and native Fastify implementation contract;
4. the behavior belongs only to a Fastify feature and does not alter shared
   compatibility data, interfaces, or workflows.

"The current behavior is saner" is evidence for a `decide` proposal, not an
automatic exemption. A regression test cannot turn an unsigned policy choice
into an accepted divergence.

The exact observable contract, evidence vocabulary, and disposition rules live
in [`CONTRACT.md`](CONTRACT.md).

## In Scope

- Shared features present at the compatibility baseline and retained in the
  Fastify application.
- Legacy data, presets, cards, scripts, settings, providers, and formats still
  accepted or projected by the current application.
- Upstream behaviors through the behavioral sync cursor that were classified as
  ported or already covered, including verification that the native Fastify
  implementation satisfies its recorded behavior.
- Signed divergences and unsupported/no-port surfaces, to verify that the
  implementation still matches the decision and does not fail silently.
- Cross-layer behavior from browser action through protocol, Fastify, SQLite,
  external request, projection, reload, and rendered outcome.
- The compatibility harness, fixture provenance, expected-difference ownership,
  affected-test selection, aggregate/release gating, and baseline reproducibility.
- Fastify-only features only where they read, write, import, export, project, or
  otherwise change shared compatibility data or workflows.

## Out Of Scope

- Physical equivalence between the original browser database and Fastify
  SQLite, protocol, job, or SSE internals when every observable result remains
  compatible.
- Reintroducing group chat, peer sync, Drive/account sync, native wrappers,
  browser-local authoritative persistence, or other standing no-port systems
  without a separate product decision.
- Treating upstream commits after the behavioral sync cursor as existing parity
  obligations. They belong to a later upstream-sync ledger before compatibility
  verification.
- Requiring live third-party provider, media, Push, or network calls in normal
  CI. Sanitized recorded fixtures and explicit bounded canaries may supplement
  deterministic tests later.
- Rewriting architecture merely to resemble the original implementation.
- Unrelated feature development.

## Observable Compatibility Surfaces

Every inventory row identifies one or more observable surfaces:

1. **Visible interaction:** controls, focus, navigation, responsive layout,
   loading/error feedback, and action results.
2. **Durable logical state:** values, identities, ordering, metadata, references,
   and mutation semantics after reload or restart.
3. **Provider or external request:** URL, method, headers, body, model, options,
   message order, retries, and fallback selection.
4. **Prompt and extension state:** prompt rows, CBS variables, Lua/trigger/script
   state, module/plugin-visible values, and post-generation transforms.
5. **Interchange:** `.risu`, `.bin`, CharX/card, chat, preset, translator, module,
   asset, backup, and restore behavior in both directions where supported.
6. **Lifecycle:** streaming display, cancel, failure, retry, reconnect, reattach,
   response loss, finalization, side effects, and terminal recovery.
7. **Diagnostics and unsupported behavior:** visible warnings, migration notices,
   explicit rejection, trace safety, and absence of silent no-ops.

Exact timing and internal event shapes are not parity requirements unless their
ordering or delay changes an observable outcome.

## Primary Audit Taxonomy

The categories intentionally align with the current test-suite and structure
maps so compatibility work reuses existing product and evidence ownership.
Every inventory row receives exactly one primary category and optional seam tags.

| ID | Primary category | Main compatibility boundaries |
| --- | --- | --- |
| A | Assurance architecture and special lanes | Baselines, cursors, fixtures, harnesses, expected differences, affected selection, CI, release gates. |
| B | Browser state synchronization and recovery | Bootstrap, writer/observer, outbox, replay, hydration, invalidation, replacement, reload. |
| C | Persistence, commands, events, and editing bridges | SQLite logical state, revisions, receipts, messages, settings writes, optimistic/queued/failed outcomes. |
| D | App navigation, chat, shared UI, and presentation | Routes, sidebars, composer, transcript, hotkeys, focus, responsive/mobile behavior, feedback. |
| E | Settings, profiles, authoring, and catalogs | Defaults, legacy shapes, presets, personas, characters, lorebooks, Realm/catalog actions, uploads. |
| F | Prompting, generation, and streaming | Assembly, templates, history, send/continue/regenerate, stream, cancel, retry, reattach, finalization. |
| G | Providers, models, credentials, translation, and media | Capability, resolution, wire requests, secrets, endpoints, translation, image/audio/transcription. |
| H | Memory, embeddings, summaries, jobs, and workers | Selection, context truncation, ranking, scheduling, retry, cancellation, reconciliation. |
| I | Scripting, parsing, triggers, Lua, and automation | CBS, regex, trigger ordering/effects, Lua state, display/input/output transforms, execution bounds. |
| J | Plugins, modules, MCP, and specialized tools | Import/storage, permissions, sandboxing, APIs, OAuth/tools, lifecycle, explicit unsupported behavior. |
| K | Assets, imports, exports, saves, and backups | References, codecs, historical formats, round trips, salvage, staged assets, GC, restore. |
| L | API runtime, limits, diagnostics, and platform behavior | Auth/writer policy, browser/server environment, network behavior, trace visibility, startup/shutdown, Web Push. |

Boundary assignment rules:

- A visible interaction belongs to D even when its durable command evidence is
  cross-tagged C.
- Model-visible assembly and generation lifecycle belong to F; provider-specific
  wire behavior belongs to G.
- Settings authoring belongs to E; runtime application belongs to its consuming
  category.
- Realm/catalog interaction belongs to E; package bytes and atomic import belong
  to K.
- Script definitions and execution semantics belong to I; module/plugin host and
  lifecycle behavior belong to J.
- Cross-layer recovery belongs to the owning product category with B/C seam tags
  unless the recovery mechanism itself is the subject.

## Required Inventory Schema

The authoritative inventory remains machine-readable and independently
checkable. Each row records at least:

- stable compatibility ID and feature/scenario name;
- primary category and seam tags;
- source obligation: `fork-parity`, `synced-upstream`, `signed-divergence`,
  `standing-unsupported`, or `fastify-only-interaction`;
- compatibility-baseline owner and line/symbol evidence where applicable;
- upstream commit/disposition and native port commit where applicable;
- current browser, protocol, Fastify, persistence, and UI owners;
- legacy/default/missing-value and failure/recovery variants;
- observable surfaces and semantic comparison fields;
- current unit, integration, compatibility, browser, round-trip, and structural
  evidence;
- normalization rules and fixture provenance;
- verification state, confidence, severity, proposed disposition, signed
  decision ID, finding ID, implementation commit, and regression owner;
- last verified Fastify commit and residual/revisit condition.

No row is complete merely because an upstream change is `DONE`. Upstream
disposition and current Fastify behavioral verification are separate fields.

## Cross-Cutting Scenario Dimensions

Each domain phase applies the relevant subset of this shared matrix:

- default and non-default configuration;
- missing, `undefined`, `null`, empty, malformed, and legacy-shaped values;
- create, select/apply, edit, delete, copy/fork, import/export, and reload;
- buffered, streamed, half-streamed, multi-result, and provider-specific paths;
- failure before output, failure after partial output, cancel, retry, fallback,
  reconnect, response loss, restart, and reattach;
- rapid repeated actions, stale completion, target disappearance, cross-chat
  navigation, concurrent browser work, and writer takeover;
- exact data/identity/reference preservation and user-visible feedback.

Use pairwise and risk-based cases rather than an unbounded Cartesian product.
Every omitted high-risk combination needs a rationale or a later owner.

## Evidence Layers

Prefer the smallest faithful proof, then add a companion layer when the user
outcome crosses boundaries:

1. structural completeness or closed-world classification gate;
2. pure deterministic baseline/current differential fixture;
3. current browser/server parity fixture against a shared semantic contract;
4. in-process Fastify/SQLite integration through the production route;
5. cross-application encode/decode or import/export round trip;
6. built-browser journey through rendered UI, Fastify, and SQLite;
7. controlled fault injection for cancel, race, response loss, restart, and
   terminal recovery.

Mocks may isolate unrelated dependencies but may not replace the behavior under
comparison. Source tracing may establish a candidate finding but does not prove
a user-visible runtime difference when a deterministic reproduction is feasible.

## Normalization And Golden Rules

- Normalize only nondeterministic identities, timestamps, credential values, and
  transport noise with a documented semantic reason.
- Preserve missing-versus-null, type, role, array ordering, reference identity,
  endpoint path/query, status, error, and metadata differences when observable.
- Every expected difference maps to a signed decision ID. A golden alone is not
  a decision registry.
- Golden refreshes require an explicit semantic review and paired decision or
  finding update. Never refresh merely to make a gate pass.
- Closure requires zero unexplained differences, not zero raw differences.

## Findings And Decisions

Findings use stable IDs `ORC-<CATEGORY>-<number>`. Raw reports retain their own
source IDs and map exactly once to a canonical finding, an existing decision, or
a recorded not-a-finding outcome.

Keep these axes separate:

- **Severity:** Critical, High, Medium, Low.
- **Evidence:** reported, cross-confirmed, code-verified, reproduced.
- **Verification:** pending, confirmed, adjusted, refuted.
- **Disposition:** fix, decide, signed-keep, standing-unsupported, resolved,
  deferred.

Every confirmed finding records expected and actual behavior, user consequence,
both-side evidence, reproduction, affected inventory rows, remediation owner,
regression proof, and residual risk. High-impact and single-track findings are
independently re-verified before implementation.

## Structural Deliverables

Each domain phase must look for a closed-world check that prevents its omission
class even when no defect is found. Priority candidates include:

- settings/default/command-group/resource projection classification;
- legacy preset save/apply field completeness;
- model profile/runtime option/cache/provider dispatch ownership;
- provider capability, endpoint, header, and option matrices;
- prompt/CBS/lore/script client/server shared fixtures;
- persisted substructure and SQLite table backup/export classification;
- portable block, asset-reference, and historical-format ownership;
- command route, event, SSE, protocol, and expected-difference vocabularies;
- explicit unsupported/no-port UI and diagnostic ownership.

## Work Units And Slice Rules

- One slice covers one cohesive behavioral boundary, fixture family, or
  remediation mechanism.
- Name exact original/current symbols and owning tests; a directory glob alone
  is not evidence.
- Audit and remediation may share a slice only when the evidence is complete and
  the fix is narrow. Otherwise land the verified finding before implementation.
- Independent discovery reports do not edit production code.
- A slice records inventory rows, source obligations, observables, scenario
  variants, evidence, findings, decisions, files, validation, rollback, and
  residual risk.
- Update `status.md`, the inventory, finding/decision records, and
  `latest-verification.md` whenever a slice or phase changes state.
- Do not mark a phase complete while an in-scope row lacks a disposition or an
  exit criterion lacks an explicit owner, reason, and revisit condition.

## Phase Overview

- [Phase 0](phases/phase-0-cursors-contract-and-inventory.md) freezes cursors,
  imports decisions, establishes inventory/finding schemas, and runs the pilot.
- [Phase 1](phases/phase-1-harness-and-assurance-architecture.md) makes baseline,
  harness, fixture, expected-difference, affected-test, CI, and release ownership
  reproducible.
- [Phases 2-12](phases/README.md) audit the eleven product-risk categories in
  dependency-aware order.
- [Phase 13](phases/phase-13-consolidation-adjudication-and-remediation.md)
  resolves cross-category findings, shared gates, maintainer decisions, and
  remediation waves without reopening completed domain inventories.
- [Phase 14](phases/phase-14-verification-and-closeout.md) proves zero unexplained
  differences, complete decisions, final gates, current docs, and archive handoff.

## Decision And Stopping Gates

### Before Phase 1

- The three-reference model and source-obligation vocabulary are ratified.
- Prior compatibility decisions and upstream dispositions through the behavioral
  sync cursor are imported or recorded as explicit gaps.
- The inventory and finding schemas are machine-readable and pilot-tested.
- The baseline-worktree prerequisite has an exact reproducible procedure and
  current state.
- Phase 1 and the first domain slice have exact inputs and no ownership ambiguity.

### Before A Domain Phase Closes

- Every in-scope row has a verification state and disposition.
- Every Critical/High finding is fixed, routed to a dependency phase, or deferred
  with owner, reason, and concrete revisit trigger.
- Every expected difference maps to a signed decision.
- Required structural and behavioral evidence is live or explicitly assigned.
- Focused and owning-lane validation passes.

### Before Phase 13

- All domain inventories are complete and current at a recorded Fastify commit.
- Cross-category duplicates and shared mechanisms have named owners.
- Every open maintainer decision has verified evidence and concrete alternatives.
- Phase 13 is a bounded consolidation/remediation queue, not a second discovery
  audit.

### Before Phase 14

- No unowned pending finding, unsigned expected difference, or silent unsupported
  surface remains.
- All implementation commits, regression owners, fixture/golden changes,
  accepted residuals, and documentation changes are recorded.
- Full differential prerequisites are available or the workstream cannot close.

## Validation Strategy

Audit-only documentation slices run formatting and `git diff --check` and record
why runtime tests are unnecessary. Remediation slices run:

1. focused owning tests;
2. `pnpm test:affected --dry-run` and every selected lane;
3. complete frontend/server ownership when shared fixtures, harnesses, or broad
   contracts change;
4. browser smoke for rendered, reload, multi-tab, responsive, or recovery work;
5. `pnpm test:compat-current` for compatibility-harness/current-golden changes;
6. `pnpm test:compat-harness` for fork-point claims when the pinned baseline is
   available;
7. isolated scale/performance gates where the contract includes a budget;
8. `pnpm test:all` for aggregate runner, CI, or final closeout changes;
9. formatting and `git diff --check`.

Phase 1 decides the permanent PR, affected-path, nightly, and release schedule.
The full pinned differential cannot remain an undocumented local-only promise.

## Documentation And Archive Rules

- `PLAN.md` owns stable scope and decisions that span phases.
- `CONTRACT.md` owns the observable contract and decision vocabulary.
- `status.md` is the only live phase/slice router.
- Phase files own detailed scope, questions, outputs, exit criteria, and
  validation.
- `inventory/` and `findings/` own machine-readable coverage and canonical
  findings; narrative phase files link rather than duplicate them.
- `latest-verification.md` owns command and artifact proof.
- Current shipped behavior remains documented under `STRUCTURE.md`,
  `docs/structure/`, `src/docs/`, and `docs/tests/`; this plan does not supersede
  those guides before changes land.
- When Phase 14 closes, move the intact workstream to `.archived-docs/` and
  update the relevant archive and active-plan indexes.

## Execution Cursor

Phase 0 is open. The planning anchor, compatibility baseline, and behavioral
sync cursor are frozen above. Live progress, current blockers, and validation
belong in [`status.md`](status.md).
