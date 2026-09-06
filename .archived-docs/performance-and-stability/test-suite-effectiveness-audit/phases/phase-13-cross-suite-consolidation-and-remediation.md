# Phase 13: Cross-Suite Consolidation And Remediation

Status: Complete on 2026-08-29; all domain inventories, bounded remediation,
and final aggregate gates are complete. Phase 14 owns closeout.

## Objective

Resolve only the cross-category decisions that could not be safely completed
inside a domain phase: equivalent duplication, shared harnesses, client/server
parity, mega-suite boundaries, remaining removals/replacements, and material
coverage gaps.

This is a bounded synthesis phase, not a second repository-wide audit.

## Scope

- Reconcile duplicate-contract findings across unit, storage, API, DOM, browser,
  compatibility, security, and performance layers.
- Merge repeated race/focus/rollback/provider/route matrices only when failure
  modes and lifecycle ownership are equivalent.
- Split mega-suites when independent failures or mocks obscure ownership; do not
  split mechanically by `describe` count.
- Consolidate shared fixtures/helpers/oracles where current copies can drift,
  while preserving per-file isolation and clear failure diagnostics.
- Add or generate shared parity contracts for typed routes, SSE vocabulary,
  provider capabilities/options, prompt/lore semantics, preset schemas, and
  asset-owner catalogs where domain findings justify them.
- Implement remaining evidence-approved removals and clean orphaned support
  artifacts, routing entries, inventories, goldens, snapshots, and docs.
- Add bounded high-risk browser/integration proof prioritized by confirmed gaps,
  not by global coverage percentage.

## Entry Gate

- Every Phase 2-12 inventory row has a disposition.
- Every cross-category candidate has a stable finding ID, exact owner, and
  bounded action.
- No new broad category search is scheduled here.
- Critical/High findings are already resolved or explicitly owned by this phase.

The gate was satisfied with 700/700 live owners dispositioned, no Pending row,
and stable finding owners for every Phase 2-12 residual. Parallel read-only
cross-checks covered duplicate candidates, asset vocabulary, large-entry
materialization, browser composition, provider/MCP support, and orphan/support
artifacts before implementation.

## Remediation Record

### Final duplicate and defense-in-depth map

| Candidate family | Final decision and rationale |
| ---------------- | ---------------------------- |
| Durable mutations, rollback, and recovery across storage, command, DOM, and browser owners | Keep. Each layer owns a different rejection, persistence, projection, or visible recovery oracle. |
| Provider capability/options and client/server transport matrices | Keep. Request construction, credential binding, upstream framing, browser dispatch, and compatibility fail independently. No pair had equivalent fault injection and assertion ownership. |
| Route/auth policy helper, manifest, inject, and live composition owners | Keep. Independent exception allowlists intentionally detect production-manifest widening; helper tests cannot replace handler no-side-effect proof. |
| Prompt/lore/script client/server parity | Keep current pairs. Browser display, server execution, persisted-definition validation, and compatibility semantics are not equivalent even when fixtures resemble one another. |
| Asset discovery, legacy rewriting, and GC | Consolidate only the narrow declarative asset-owner vocabulary. Retain shape-specific walkers and scoped/broad GC parity because arbitrary plugin JSON, SQLite messages, and operational references have different ownership. |
| Resource database test helper | Remove the hidden bootstrap-response adapter after migrating all six consumers to explicit settings/collections/characters reads behind a common-revision fence. Retain the browser-shaped fetch reader. |
| Dense commands/generation/browser suites | Do not split mechanically. Review found no independent mock/lifecycle boundary whose move improved isolation without adding shared-state churn. |
| Compatibility, performance, direct Realm, coverage, fixtures, goldens, and browser support | Keep. Discovery and support scans found no orphan; these artifacts own opt-in or isolated lanes unavailable to ordinary tests. |

No test-file pair met the mandatory Merge proof. The final Merge decision is
therefore zero, not unfinished work. Boundary-specific retention is recorded by
`TSA-P13-006` so future audits do not infer duplication from names alone.

### Removal and replacement package

`installResourceDatabaseBootstrapAdapter` was the only evidence-approved
cleanup. It globally intercepted `app.inject` and synthesized a whole
`database` property that production bootstrap never returns. Six consumer
suites now call `injectComposedResourceDatabase` explicitly when they need the
settings/collections/characters aggregate; revision and lineage assertions use
the untouched bootstrap JSON. The existing three-attempt common-revision fence
and `readResourceDatabaseFromFetch` remain. Initialized production bootstrap
has an explicit no-`database` assertion, repository search finds no installer
symbol or migrated `.json().database` use, and nine focused owners passed
582/582 cases. The helper file remains live for the two explicit readers, so no
support artifact or test owner was removed.

### Shared parity and material gap closure

- Legacy bot-preset snapshot/apply now includes `additionalParams`; the
  route-level regression proves both the outgoing saved value and selected
  target value through persistence.
- Portable discovery and legacy `.bin` rewriting consume
  `assetOwnerCatalog.ts`. Their common positive corpus, arbitrary-JSON negative,
  and existing scoped/broad GC equality protect the shared vocabulary without
  treating every SHA-like string as an asset.
- ZIP and legacy local-backup assets hash and write directly to temporary
  staging files. Unrelated legacy payloads are skipped without allocation; the
  embedded database uses the already-authoritative inner `.risu` ceiling before
  buffering; hash/abort failures close and remove staging. Manifest and database
  control records remain intentionally buffered for their existing decoders.
- A localhost-only Chromium journey authors a setting, downloads a real local
  backup, authors a conflicting value, restores through visible dialogs and the
  file chooser, observes replacement resync, reloads, and verifies durability.

These changes add 11 Fastify cases and one browser case without adding an
owner: commands `+1`, local-backup database parity `+1`, bundle import `+9`,
and browser smoke `+1`. The final live universe is 700 owners / 10,212 cases /
one direct-only skip / 1,332 parameterized rows. Categories remain A=21, B=39,
C=62, D=111, E=101, F=84, G=109, H=26, I=39, J=42, K=25, and L=41;
decisions remain 617 Keep / 83 Reclassify / zero Pending. Support remains 252
standalone artifacts and 64 mixed production seams.

### Explicit residual handoff

`TSA-P13-008` is the bounded residual. No tracked sanitized provider/media/Push
transcript, locally conformant MCP/plugin service, paid-call authority,
Firefox/WebKit CI lane, browser fault-injection harness, or exact compatibility
baseline is available. Current `.risu` export also materializes its database
snapshot and encoded envelope; a safe fix requires a streaming cursor/writer
design and product authority for legacy behavior, while an arbitrary cap could
make user data unexportable. Phase 14 must record these as final supported-claim
boundaries, never substitute the pinned baseline or refresh goldens, and close
the workstream only after all current deterministic lanes pass.

## Required Outputs

- Final duplicate/defense-in-depth map and rationale.
- Completed removal and merge evidence packages.
- Shared parity/harness changes with negative self-proof where appropriate.
- Material gap closure or explicit deferred owner/revisit condition.
- Reconciled inventory, finding ledger, decision totals, file/case counts, and
  specialized ownership.

## Exit Criteria

- No unowned Pending decision remains.
- Every Remove/Merge decision is implemented or rejected with evidence.
- No orphaned helper, fixture, registration, coverage owner, golden, snapshot,
  screenshot, or test-only export remains after accepted cleanup.
- Retained defense in depth is documented so future audits do not reclassify it
  as accidental duplication.
- Shared parity and harness changes have positive and negative proof.
- All Critical/High findings are Done or Deferred only under an explicit
  authority/external dependency with a concrete revisit condition.

## Validation

- Focused tests for every changed family
- `pnpm check:frontend-test-inventory`
- `pnpm test:affected --dry-run` and every selected lane
- `pnpm test:frontend:all`
- `pnpm test:server`
- `pnpm test:gates`
- `pnpm coverage:ui-map`
- `pnpm test:compat-harness` when affected and prerequisites are available
- `pnpm test:smoke`
- `pnpm check` and `pnpm check:server`
- `pnpm test:all`
- `pnpm format:check`
- `git diff --check`

All validation passed. Focused proof covered 582 resource-migration, 224
commands, 28 shared-asset, 90 import/export, and 6 owning-browser cases. The
affected matrix passed 6,771 ordinary frontend, 6 performance, 3,398 Fastify
plus one intentional skip, and 36 Chromium cases. `pnpm test:all` passed every
lane in 4m 2.3s: checked inventories; zero-diagnostic server/browser and
frontend checks; 6,565 partitioned frontend cases; 206 UI-map cases and all
thresholds; 3,398 Fastify plus the intentional Realm skip; the direct Realm
scale case; 36 Chromium journeys; format; and 6 isolated performance cases.
Current-only compatibility passed 18/18. Full differential compatibility
stopped only at the missing exact pinned worktree; no substitute or golden
refresh was used.
