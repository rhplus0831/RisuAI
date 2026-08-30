# Cross-Runtime Boundaries Status

Date: 2026-08-31

This is the mutable execution router. Stable scope and gates live in
[`PLAN.md`](PLAN.md), phase detail in [`phases/`](phases/README.md), the next
review-sized task in [`next-steps.md`](next-steps.md), and the latest exact proof
in [`latest-verification.md`](latest-verification.md).

## Current Snapshot

- Plan state: Active; Phases 0 through 2 complete; fourteen Phase 3 leaf slices are
  complete.
- Current phase: [Phase 3 pure shared core](phases/phase-3-pure-shared-core.md).
- Active slice: [Script-model overrides](phases/slices/phase-3-pure-shared-core/script-model-overrides.md), ready.
- Opening Fastify code anchor: `c0df82d5240a29a33efa5995e08cc970e0147573`.
- Runtime changes through Phase 1: shell, character-summary,
  provider-operation, embedding-operation, image-generation, TTS-synthesis,
  server-tool, client-context, display-source, MCP OAuth refresh, and
  standalone-settings contracts moved to explicit protocol subpaths without
  wire changes.
- Latest implementation candidate: Agent-only lorebook predicate at
  `4162150ec`, after model-role resolution at `22d6799dd`; focused
  predicate/ownership, affected browser/Fastify Agent and lorebook owners,
  architecture inventory, shared-core/root/downstream typechecks, formatting,
  and diff checks passed; see
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
| Browser operation metadata reconciliation | `6a6d0ac1f` | Released with 55 reviewed shared-route relations, seven explicit non-overlaps, and fail-closed owner/transport parity. |
| Shared-core foundation and first leaf | `d798740f7` (`d78c67a3a` parity proof) | Released with an independently checked package boundary and one shared chat-page normalizer used by three browser and one Fastify call sites. |
| Chat load-page normalization | `c12e807a5` | Released through `@risuai/shared-core/chat-load-pages`; every production consumer uses the shared leaf and one production root-`src` edge was removed. |
| Chat display-tail normalization | `6fc15d7a1` | Released through `@risuai/shared-core/chat-display-tail-count`; both production consumers use the shared leaf and one production root-`src` edge was removed. |
| Regex output-size normalization | `83e8aabfa` | Released through `@risuai/shared-core/regex-output-size-limit`; all eight production consumers use the shared leaf and four production root-`src` edges were removed. |
| Legacy OpenAI model aliases | `23e5a4b30` | Released through `@risuai/shared-core/legacy-openai-model-aliases`; all four production consumers use the shared leaf and three production root-`src` edges were removed. |
| Internal-reasoning stripping | `251c9d043` | Released through `@risuai/shared-core/internal-reasoning`; all five production consumers use the shared leaf and three production root-`src` edges were removed. |
| Agent-preset output references | `12d2840b1` | Released through `@risuai/shared-core/agent-preset-output-references`; all three production consumers use the shared leaf and two production root-`src` edges were removed. |
| Punctuation trimming | `386bdd750` | Released through `@risuai/shared-core/punctuation`; all four direct production consumers use the shared leaf and two production root-`src` edges were removed. |
| Inlay-token matching | `92dde59e1` | Released through `@risuai/shared-core/inlay-tokens`; both production consumers use the shared leaf and one production root-`src` edge was removed. |
| ChatML row parsing | `14f44ed87` | Released through `@risuai/shared-core/chatml-rows`; all five production consumers use the shared leaf and two production root-`src` edges were removed. |
| History-slot rendering | `7e03538ea` | Released through `@risuai/shared-core/history-slots`; all four production consumers use the shared leaf and one production runtime/mixed root-`src` edge was removed. |
| Lore hash randomization | `1b1152814` | Released through `@risuai/shared-core/lore-hash`; browser/Fastify consumers use one implementation, the private Fastify copy is gone, and one production runtime edge was removed. |
| Model-role resolution | `22d6799dd` | Released through `@risuai/shared-core/model-roles`; all 28 production consumers use the shared leaf and eleven production/server-test root-`src` edges were removed. |
| Agent-only lorebook predicate | `4162150ec` | Released through `@risuai/shared-core/agent-only-lorebook`; all four production consumers use the shared predicate and one production runtime root-`src` edge was removed. |
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

- 302 direct root-`src` edges remain: 202 production, 92 server-test, and 8
  browser-smoke, spanning 128 importers and 56 targets.
- Usage is 105 runtime, 38 mixed, and 159 type-only; 143 runtime/mixed edges
  remain.
- The completed Phase 1 and Phase 3 slices, plus the reviewed Workstream 2
  shared-helper reuse, removed 73 edges and 23 source
  targets.
  Both consuming TypeScript projects still reference
  `tsconfig.client-lib.json`; Phase 6 remains responsible for that decoupling.

## Phase Router

| Phase | Status | Opens when |
| ---: | --- | --- |
| [0. Boundary inventory and gates](phases/phase-0-boundary-inventory-and-gates.md) | Complete | Closed at `b01e88b03`. |
| [1. Protocol contract completion](phases/phase-1-protocol-contract-completion.md) | Complete | Closed at `33d1643ae`. |
| [2. Route operation and policy catalog](phases/phase-2-route-operation-and-policy-catalog.md) | Complete | Closed at `6a6d0ac1f`. |
| [3. Pure shared core](phases/phase-3-pure-shared-core.md) | Active | Shared-core foundation and fourteen neutral leaves complete; script-model overrides are next. |
| [4. Server consumer migration](phases/phase-4-server-consumer-migration.md) | Queued | Destination contracts/helpers pass audits. |
| [5. Browser adapter migration](phases/phase-5-browser-adapter-migration.md) | Queued | Matching server/shared contracts are stable. |
| [6. Typecheck/package decoupling](phases/phase-6-typecheck-and-package-decoupling.md) | Queued | No unapproved consuming import remains. |
| [7. Verification and closeout](phases/phase-7-verification-and-closeout.md) | Queued | Phases 0-6 satisfy exit gates. |

## Blockers And Risks

- No implementation blocker prevents the next shared-core leaf.
- Existing single-source helpers still need an explicit ownership benefit and
  narrow behavior proof before moving; cross-runtime use alone is not enough.
- Existing imports mix runtime and type-only edges, tests and fixtures, wire
  contracts and application models; `baseline.json` keeps those distinctions
  fail-closed.
- Removing TypeScript references early could hide rather than remove coupling.
- A shared operation catalog must not transfer authentication or active-writer
  authority to the browser.
- Large domain moves can accidentally alter validation or masking; each family
  needs a differential/parity proof.

## Start Here

Use [`next-steps.md`](next-steps.md). Move only dependency-free script-model
override types, normalization, strict reading, lookup, and immutable update
behavior into the audited shared-core owner while leaving profile resolution,
Lua execution, database repair, persistence, and UI orchestration in their
current owners.
