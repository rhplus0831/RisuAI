# Cross-Runtime Boundaries Status

Date: 2026-08-30

This is the mutable execution router. Stable scope and gates live in
[`PLAN.md`](PLAN.md), phase detail in [`phases/`](phases/README.md), the next
review-sized task in [`next-steps.md`](next-steps.md), and the latest exact proof
in [`latest-verification.md`](latest-verification.md).

## Current Snapshot

- Plan state: Active; Phases 0 and 1 complete.
- Current phase: [Phase 2 route operation and policy catalog](phases/phase-2-route-operation-and-policy-catalog.md).
- Active slice: [Browser operation metadata reconciliation](phases/slices/phase-2-route-operation-and-policy-catalog/browser-operation-metadata-reconciliation.md), ready to start.
- Opening Fastify code anchor: `c0df82d5240a29a33efa5995e08cc970e0147573`.
- Runtime changes through Phase 1: shell, character-summary,
  provider-operation, embedding-operation, image-generation, TTS-synthesis,
  server-tool, client-context, display-source, MCP OAuth refresh, and
  standalone-settings contracts moved to explicit protocol subpaths without
  wire changes.
- Latest implementation candidate: the durable command operation catalog at
  `3f275e9dc`; focused catalog/outbox/generation/replay, protocol typecheck,
  architecture, formatting, complete affected frontend/server, and current
  compatibility evidence passed; see
  [`latest-verification.md`](latest-verification.md).

## Dependency Cursors

| Consumer or prerequisite | Cursor | State |
| --- | --- | --- |
| Portfolio no-new-debt requirement | `b01e88b03` | Released from the 375-edge opening cursor; the reviewed 337-edge baseline is mandatory in `check:server`. |
| Shell resource contract | `159b6eccf` | Released through `@risuai/protocol/shell-resource`. |
| Character-summary resource contract | `159b6eccf` | Released through `@risuai/protocol/character-summary-resource`. |
| Provider-operation contract | `9c1d0f114` | Released through `@risuai/protocol/provider-operation`; credential resolution and dispatch remain Fastify-owned. |
| Embedding-operation contract | `58a847a11` | Released through `@risuai/protocol/embedding-operation`; credential, endpoint, provider, and bounds policy remain Fastify-owned. |
| Image-generation contract | `054116c5d` | Released through `@risuai/protocol/image-generation-operation`; credentials, provider execution, Lua policy, bounds, and assets remain Fastify-owned. |
| TTS-synthesis contract | `cc7cfc0fd` | Released through `@risuai/protocol/tts-synthesis`; credentials, character configuration, endpoints, provider execution, bounds, audio validation, and errors remain Fastify-owned. |
| Server-tool contract | `8a1084a53` | Released through `@risuai/protocol/server-tool`; tool execution, provider translation, prompts, authorization, writer authority, and persistence remain in their current owners. |
| Client-context contract | `e729dabe4` | Released through `@risuai/protocol/client-context`; browser environment capture, prompt/CBS behavior, authorization, and writer policy remain in their current owners. |
| Display-source contract | `07abd8aa5` | Released through `@risuai/protocol/display-source`; rendering, parser/CBS execution, caches, persistence, authorization, revision checks, and writer policy remain in their current owners. |
| MCP OAuth refresh contract | `4f6e0ef1b` | Released through `@risuai/protocol/mcp-oauth-refresh`; credentials, identity/URL checks, egress, rotation, timeouts, bounds, parsing, errors, and masking remain in their current owners. |
| Standalone-settings contract | `33d1643ae` | Released through `@risuai/protocol/standalone-settings`; storage, projection, revision, repair, invalidation, authentication, and writer policy remain in their current owners. |
| Phase 1 protocol conventions | `33d1643ae` | Released; the inventoried `protocol-wire-contract` policy is empty and Phase 2 may build on the package conventions. |
| Shared route operation catalog | `00e49d880` | Implemented with 103 browser-safe transport descriptors and exact ID parity with 103 Fastify-owned auth/writer policies; final full-suite rerun is deferred. |
| Shared durable command operation catalog | `3f275e9dc` | Released with 129 stable identifiers, an exact opening-matcher fingerprint, fail-closed duplicate/ambiguity checks, and generation intent links to shared route IDs. |
| Workstream 2 inventory prerequisite | Package/dependency conventions at `b01e88b03` | Released. |
| Workstream 2 shared-contract prerequisite | Per contract family | Blocked until the matching Phase 1 contract closes. |
| Workstream 3 contract prerequisite | Per contract/resource family | Blocked until the matching Phase 1/2 contract closes. |
| Workstream 4 shared-event prerequisite | Stable event schemas | Not released; Workstream 4 is inactive. |

## Phase 0 Inventory Snapshot

- The checked inventory records 375 direct root-`src` edges: 260 production,
  107 server-test, and 8 browser-smoke, spanning 148 importers and 79 targets.
- Usage is 147 runtime, 46 mixed, and 182 type-only; syntax is 373 static
  imports, one re-export, and one dynamic import.
- `util/check-server.ts` now runs protocol and architecture gates before the
  client declaration emit, then the Fastify and browser-smoke checks; both
  consuming TypeScript projects still reference `tsconfig.client-lib.json`.
- `packages/protocol/src/importBoundary.test.ts`,
  `server/fastify/__tests__/routeProtection.test.ts`, and the repository's
  structural compatibility tests provide existing gate conventions.
- Candidate early contract families include shell/character-summary resources,
  generation operations, provider/media operations, display-source requests,
  and server-tool requests. Phase 0 owns classification; this list is not an
  approval to move them together.

## Current Boundary Cursor

- 336 direct root-`src` edges remain: 233 production, 95 server-test, and 8
  browser-smoke, spanning 132 importers and 68 targets.
- Usage is 134 runtime, 39 mixed, and 163 type-only; 173 runtime/mixed edges
  remain.
- The completed Phase 1 slices removed 39 edges and 11 source targets.
  Both consuming TypeScript projects still reference
  `tsconfig.client-lib.json`; Phase 6 remains responsible for that decoupling.

## Phase Router

| Phase | Status | Opens when |
| ---: | --- | --- |
| [0. Boundary inventory and gates](phases/phase-0-boundary-inventory-and-gates.md) | Complete | Closed at `b01e88b03`. |
| [1. Protocol contract completion](phases/phase-1-protocol-contract-completion.md) | Complete | Closed at `33d1643ae`. |
| [2. Route operation and policy catalog](phases/phase-2-route-operation-and-policy-catalog.md) | Active | Current execution cursor; Phase 1 operation conventions are stable. |
| [3. Pure shared core](phases/phase-3-pure-shared-core.md) | Queued | Phase 0 classifications name neutral leaf candidates. |
| [4. Server consumer migration](phases/phase-4-server-consumer-migration.md) | Queued | Destination contracts/helpers pass audits. |
| [5. Browser adapter migration](phases/phase-5-browser-adapter-migration.md) | Queued | Matching server/shared contracts are stable. |
| [6. Typecheck/package decoupling](phases/phase-6-typecheck-and-package-decoupling.md) | Queued | No unapproved consuming import remains. |
| [7. Verification and closeout](phases/phase-7-verification-and-closeout.md) | Queued | Phases 0-6 satisfy exit gates. |

## Blockers And Risks

- No implementation blocker prevents browser operation metadata reconciliation.
- Final Phase 2 verification remains pending until resource, cache, generation,
  and raw-generation metadata are reconciled.
- Existing imports mix runtime and type-only edges, tests and fixtures, wire
  contracts and application models; `baseline.json` keeps those distinctions
  fail-closed.
- Removing TypeScript references early could hide rather than remove coupling.
- A shared operation catalog must not transfer authentication or active-writer
  authority to the browser.
- Large domain moves can accidentally alter validation or masking; each family
  needs a differential/parity proof.

## Start Here

Use [`next-steps.md`](next-steps.md). Reconcile browser resource, cache,
generation, and raw-generation metadata against the shared route and durable
operation catalogs without moving authority into the browser.
