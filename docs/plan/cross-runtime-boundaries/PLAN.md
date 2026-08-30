# Cross-Runtime Boundaries Plan

Date: 2026-08-30

Status: active. Phases 0 and 1 are complete; Phase 2 is the execution cursor.

## Goal

Establish a stable dependency direction between the browser, shared contracts,
and Fastify. Eliminate the server typecheck's dependency on emitted browser
declarations and prevent equivalent coupling from returning through another
import shape.

This workstream activates Workstream 1 of the
[Architecture Modernization Roadmap](../../architecture-modernization/PLAN.md).
[`status.md`](status.md) is the mutable execution router. This plan owns stable
scope, invariants, phase order, and closeout gates; it does not supersede
[`STRUCTURE.md`](../../../STRUCTURE.md), current architecture guides, or shipped
behavior.

## Opening Baseline

- `packages/protocol` is already browser-safe and schema-first, but its public
  surface is limited to generation SSE, startup telemetry, and BardWiki
  contracts.
- Fastify production code, server tests, and browser smoke still import many
  modules from `src/`; Phase 0 must classify every edge instead of assuming that
  a type-only import is harmless.
- `pnpm check:server` currently builds `tsconfig.client-lib.json` into
  `dist/client-types`, and both the Fastify and browser-smoke TypeScript projects
  reference that declaration project.
- Server route policy lives in `server/fastify/src/routeManifest.ts`, while the
  browser maintains separate operation, durable-command, resource, cache, and
  stream metadata. Their overlap has tests but no common operation catalog.

These are planning observations, not the authoritative Phase 0 inventory.

## End State

- Production Fastify code has no unapproved import from the browser application
  tree.
- Serialized client/server contracts live in `packages/protocol` and are
  exported through explicit package subpaths.
- Framework-neutral behavior shared by browser and server lives in an audited
  pure package or another explicitly neutral boundary.
- Server security, persistence, credential, filesystem, process, and host
  behavior remain server-owned.
- Route policy and browser operation metadata have one machine-checkable owner
  or an exact parity gate keyed by stable operation identifiers.
- `pnpm check:server` passes in a clean worktree without first generating
  `dist/client-types`.

## Invariants

1. `packages/protocol` remains browser-safe, schema-first, side-effect-free, and
   unable to import application, Svelte, Fastify, database, or Node-only code.
2. Shared runtime logic remains framework-neutral. Moving a module never moves
   server security policy or persistence behavior into a shared owner.
3. Contract migration preserves validation, compatibility versions, masking,
   payload limits, and authoritative recovery.
4. Client operation metadata never becomes an authentication or active-writer
   authority.
5. A slice introduces a destination and proves parity before deleting the last
   known-good consumer path.
6. Typecheck decoupling happens only after the import graph is actually
   independent; changing a TypeScript reference alone is not completion.

## In Scope

- Production, server-test, and browser-smoke imports from `src/`.
- Request, response, event, version, taxonomy, route-operation, resource, cache,
  and stream contracts shared across runtimes.
- Pure algorithms, normalizers, and types genuinely consumed by both runtimes.
- Fastify and browser adapter migrations needed to adopt the new owners.
- Import-boundary, contract-parity, route-policy, package, and clean-worktree
  typecheck gates.

## Non-Goals

- Moving Svelte stores or the aggregate `Database` facade into a shared package.
- Turning `packages/protocol` into a general application-logic package.
- Redesigning provider behavior, prompts, persistence, revisions, receipts,
  outbox behavior, or event recovery while moving code.
- Adding replay-safe event deltas.
- Creating a separate server package manifest before the dependency graph is
  demonstrably independent.

## Dependency Cursors

| Cursor | Initial value | Meaning |
| --- | --- | --- |
| Opening Fastify code anchor | `c0df82d5240a29a33efa5995e08cc970e0147573` | Code state inspected while activating the plan; not an implementation-completion claim. |
| Portfolio authority | `docs/architecture-modernization/PLAN.md` dated 2026-08-30 | Stable cross-workstream dependency and invariant source. |
| No-new-debt gate | Released at `b01e88b03` | The reproducible 375-edge manifest runs in `check:server`. |
| Boundary-convention release | Released at `b01e88b03` | Workstream 2 inventory is unblocked; Phase 1 releases shared contracts per family. |
| Canonical-owner consumers | Per resource, not established | Workstream 2 may consume stable shared contracts without waiting for whole-plan closeout. |
| Client-owner consumers | Per resource, not established | Workstream 3 may migrate only after the relevant contracts are stable. |

Moving implementation cursors belong in [`status.md`](status.md), not here.

## Work Units

One slice covers one contract family, one pure leaf module, one server consumer
domain, or one verifiable gate. Every slice records:

- source and destination symbols and the import edges it changes;
- classification as wire contract, pure runtime behavior, application model,
  test fixture, or server-only behavior;
- mutations, persistence effects, route policy, event behavior, and masking
  behavior, including an explicit `none` where appropriate;
- parity proof, validation commands, rollback path, residual risk, and stopping
  condition;
- the exact Workstream 2 or 3 dependency cursor it releases, if any.

Do not combine a new contract, broad consumer migration, and removal of every
old path in one review batch.

## Phase Order

| Phase | Outcome |
| ---: | --- |
| [0. Boundary inventory and no-new-debt gates](phases/phase-0-boundary-inventory-and-gates.md) | Reproducible classified baseline and a gate preventing growth. |
| [1. Protocol contract completion](phases/phase-1-protocol-contract-completion.md) | Shared serialized contracts have explicit protocol owners and parity tests. |
| [2. Route operation and policy catalog](phases/phase-2-route-operation-and-policy-catalog.md) | Route and browser operation vocabularies cannot drift silently. |
| [3. Pure shared core](phases/phase-3-pure-shared-core.md) | Audited neutral runtime helpers are extracted leaf-first. |
| [4. Server consumer migration](phases/phase-4-server-consumer-migration.md) | Fastify production/tests no longer depend on unapproved browser modules. |
| [5. Browser adapter migration](phases/phase-5-browser-adapter-migration.md) | Browser adapters consume the shared operation and wire contracts. |
| [6. Typecheck and package decoupling](phases/phase-6-typecheck-and-package-decoupling.md) | Server checks need no generated browser declarations. |
| [7. Verification and closeout](phases/phase-7-verification-and-closeout.md) | Boundaries, docs, tests, exceptions, and archive handoff are complete. |

## Rollback

Keep each introduced contract or module independently revertible until both
runtime consumers pass parity tests. Retain the old import or adapter until the
replacement is verified, but freeze it against new consumers. If a move changes
observable behavior, masking, policy, persistence, or event semantics, stop and
split behavioral remediation from boundary migration.

## Closeout Criteria

- The approved import baseline contains no production server-to-browser edge;
  any retained test-only exception has an owner and review/removal trigger.
- Protocol and pure-shared package audits pass and prevent forbidden imports.
- Every registered route has reviewed machine-checkable policy coverage, and
  browser durable-operation metadata is derived or exactly parity-checked.
- `pnpm check:server` passes from a clean worktree without client declaration
  generation or a reference to `tsconfig.client-lib.json`.
- Focused parity tests, complete owning lanes, browser smoke, typechecks,
  formatting, and diff checks pass at one recorded commit.
- Current architecture/testing/generated-path docs are updated, deliberate
  exceptions are recorded, and the intact workstream is ready to archive.
