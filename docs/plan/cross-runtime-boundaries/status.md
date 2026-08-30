# Cross-Runtime Boundaries Status

Date: 2026-08-30

This is the mutable execution router. Stable scope and gates live in
[`PLAN.md`](PLAN.md), phase detail in [`phases/`](phases/README.md), the next
review-sized task in [`next-steps.md`](next-steps.md), and the latest exact proof
in [`latest-verification.md`](latest-verification.md).

## Current Snapshot

- Plan state: Active; implementation not started.
- Current phase: [Phase 0 boundary inventory and no-new-debt gates](phases/phase-0-boundary-inventory-and-gates.md).
- Active slice: [Boundary baseline and no-new-debt gate](phases/slices/phase-0-boundary-inventory-and-gates/baseline-and-no-new-debt-gate.md), ready to start.
- Opening Fastify code anchor: `c0df82d5240a29a33efa5995e08cc970e0147573`.
- Runtime changes in this activation: none.
- Latest verification: no workstream implementation run yet; see
  [`latest-verification.md`](latest-verification.md).

## Dependency Cursors

| Consumer or prerequisite | Cursor | State |
| --- | --- | --- |
| Portfolio no-new-debt requirement | Workstream 1 Phase 0 | Current execution cursor. |
| Workstream 2 inventory prerequisite | Package/dependency conventions | Blocked until Phase 0 records and releases them. |
| Workstream 2 shared-contract prerequisite | Per contract family | Blocked until the matching Phase 1 contract closes. |
| Workstream 3 contract prerequisite | Per contract/resource family | Blocked until the matching Phase 1/2 contract closes. |
| Workstream 4 shared-event prerequisite | Stable event schemas | Not released; Workstream 4 is inactive. |

## Opening Research Snapshot

- An exploratory scan found root-`src` imports in production Fastify, server
  tests, and four browser-smoke files. Phase 0 must regenerate and classify the
  exact manifest using an AST-backed tool.
- `util/check-server.ts` currently runs the protocol check, client declaration
  emit, Fastify check, and browser-smoke check; both consuming TypeScript
  projects reference `tsconfig.client-lib.json`.
- `packages/protocol/src/importBoundary.test.ts`,
  `server/fastify/__tests__/routeProtection.test.ts`, and the repository's
  structural compatibility tests provide existing gate conventions.
- Candidate early contract families include shell/character-summary resources,
  generation operations, provider/media operations, display-source requests,
  and server-tool requests. Phase 0 owns classification; this list is not an
  approval to move them together.

## Phase Router

| Phase | Status | Opens when |
| ---: | --- | --- |
| [0. Boundary inventory and gates](phases/phase-0-boundary-inventory-and-gates.md) | Ready | Now. |
| [1. Protocol contract completion](phases/phase-1-protocol-contract-completion.md) | Queued | Phase 0 inventory and gate are accepted. |
| [2. Route operation and policy catalog](phases/phase-2-route-operation-and-policy-catalog.md) | Queued | Phase 1 operation conventions are stable. |
| [3. Pure shared core](phases/phase-3-pure-shared-core.md) | Queued | Phase 0 classifications name neutral leaf candidates. |
| [4. Server consumer migration](phases/phase-4-server-consumer-migration.md) | Queued | Destination contracts/helpers pass audits. |
| [5. Browser adapter migration](phases/phase-5-browser-adapter-migration.md) | Queued | Matching server/shared contracts are stable. |
| [6. Typecheck/package decoupling](phases/phase-6-typecheck-and-package-decoupling.md) | Queued | No unapproved consuming import remains. |
| [7. Verification and closeout](phases/phase-7-verification-and-closeout.md) | Queued | Phases 0-6 satisfy exit gates. |

## Blockers And Risks

- No blocker prevents Phase 0 inventory work.
- Existing imports mix runtime and type-only edges, tests and fixtures, wire
  contracts and application models. A textual search alone is not the final
  gate.
- Removing TypeScript references early could hide rather than remove coupling.
- A shared operation catalog must not transfer authentication or active-writer
  authority to the browser.
- Large domain moves can accidentally alter validation or masking; each family
  needs a differential/parity proof.

## Start Here

Use [`next-steps.md`](next-steps.md). Create no broad extraction slice until the
Phase 0 manifest, classifications, grandfathered baseline, and CI gate are
reviewable together.
