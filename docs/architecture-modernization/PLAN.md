# Architecture Modernization Roadmap

Date: 2026-08-30

Status: portfolio proposal. This document defines a portfolio of future
workstreams. It is not itself an active implementation workstream and does not
change the current architecture.

## Purpose

Reduce the long-term maintenance cost of the Fastify migration without changing
the project's single-user, single-writer product model.

The work is divided into four independent phase-based plans:

1. Cross-runtime boundaries.
2. Canonical state and compatibility retirement.
3. Client resource ownership.
4. Replay-safe event deltas.

Only the first three should be created as active workstreams initially. The
fourth is conditional and should be created only after its prerequisites are
substantially complete and measurements justify implementation.

This portfolio is intentionally not one umbrella implementation plan. Each
workstream has a different invariant, failure boundary, completion condition,
and rollback strategy. `docs/plan/README.md` should list active workstreams and
their dependency cursors without becoming a fifth plan.

## Product Decisions Preserved

### Single-writer operation

The single-writer rule remains an intentional product constraint, not a cleanup
target. RisuAI is a self-hosted, personal application, and concurrent mutation
from multiple devices has little practical value relative to the conflict,
merge, retry, and recovery behavior it would require.

A future cross-device experience should preserve single-writer semantics and
prefer seamless handoff:

1. The new device requests takeover.
2. The current writer flushes or explicitly retains pending durable intent.
3. The server advances the writer epoch after relinquishment or a confirmed
   forced takeover.
4. The new device hydrates an authoritative revision and reattaches eligible
   running work.
5. The previous writer becomes a read-only observer.

The handoff design must not require multi-writer mutation, conflict-free data
types, or field-level merge semantics.

### Authoritative recovery

Fastify and SQLite remain authoritative. Browser caches, optimistic projections,
event deltas, and observer state must always be recoverable from authenticated
resource reads.

### Compatibility boundary

Older saves and explicitly supported legacy exports may remain compatible.
Compatibility should be normalized at import, migration, export, or an explicit
compatibility action rather than remain a second normal-runtime source of truth.

## Portfolio Invariants

Every workstream must preserve these rules:

1. No user-visible mutation is reported as accepted until the server has
   accepted it. A queued mutation remains retained intent.
2. Database lineage, active-writer epoch, mutation receipt, replay, and
   authoritative recovery semantics remain intact.
3. The protocol package remains browser-safe and schema-first. It must not
   import application, Svelte, Fastify, database, or Node-only modules.
4. Shared runtime logic must be framework-neutral. Server security policy and
   persistence behavior remain server-owned.
5. Old formats may be accepted at explicit boundaries, but internal runtime
   ownership must be singular and documented.
6. Resource-owner migration must not silently widen bootstrap or route payloads.
7. Event deltas, if implemented, are an optimization. They never remove the
   authoritative-read fallback.
8. Each implementation slice names its mutations, persistence effects, event
   behavior, rollback behavior, tests, and stopping condition.

## Dependency Model

```text
Cross-runtime boundary foundations
             |
             +--------------------+
             v                    |
Canonical state and compatibility |
             | per resource       | shared schemas and pure contracts
             v                    |
Client resource ownership <-------+
             |
             v
Measured decision: replay-safe event deltas
```

The dependencies are finer-grained than whole-plan completion:

- Workstream 1 Phase 0 establishes the no-new-debt gates before broad runtime
  changes begin.
- Workstream 1 protocol conventions must precede new shared migration or event
  contracts.
- A Workstream 2 resource-family phase must finish before Workstream 3 retires
  that resource family's compatibility access.
- Workstreams 2 and 3 may overlap only when they operate on different resource
  families. Changes to the same canonical owner must be serialized.
- Workstream 4 implementation waits for stable shared contracts, canonical
  owners, resource projections, and replay/gap recovery.

## Standard Workstream Layout

When activated, each workstream should use this structure:

```text
docs/plan/<workstream>/
  PLAN.md
  status.md
  next-steps.md
  phases/
    README.md
    phase-0-<name>.md
    phase-1-<name>.md
    ...
    slices/
      phase-<n>-<name>/
        <review-sized-slice>.md
  latest-verification.md
```

`PLAN.md` owns stable scope, end state, decisions, invariants, phase order,
non-goals, and closeout criteria. `status.md` is the mutable execution router and
records the current phase, active slice, blockers, dependency cursors, residual
risks, and latest verification. Phase files own detailed deliverables and exit
criteria. Slice files describe one independently reviewable implementation or
proof batch.

`latest-verification.md` is created or refreshed during closeout and records the
exact commit, environment, commands, results, counts, measurements, caveats, and
verdict. A completed workstream moves intact to the appropriate
`.archived-docs/` category after current architecture documents are updated.

## Workstream 1: Cross-Runtime Boundaries

Suggested path: `docs/plan/cross-runtime-boundaries/`

### Goal

Establish a stable dependency direction between the browser, shared contracts,
and Fastify. Eliminate the server typecheck's dependency on emitted client
declarations and prevent equivalent coupling from returning under a different
import shape.

### End state

- Production Fastify code has no unapproved imports from the browser application
  tree.
- Serialized client/server contracts live in `packages/protocol`.
- Framework-neutral behavior shared by browser and server lives in a separate
  pure package or another explicitly audited neutral boundary.
- Server-only security, persistence, and host behavior remain under
  `server/fastify`.
- Route policy and browser operation metadata have one machine-checkable owner
  or an exact parity gate.
- `pnpm check:server` directly checks protocol/shared-core ownership, Fastify,
  and browser-smoke projects without a generated browser declaration tree.

### Non-goals

- Moving Svelte stores or the aggregate `Database` facade into a shared package.
- Turning `packages/protocol` into a general application-logic package.
- Redesigning provider behavior, prompt semantics, or persistence while moving
  code.
- Creating a separate server package manifest before the dependency graph is
  actually independent.

### Phases

#### Phase 0: Boundary inventory and no-new-debt gates

- Inventory production, server-test, and browser-smoke imports from `src/`.
- Classify each edge as wire contract, pure runtime behavior, application model,
  test fixture, or accidental dependency.
- Inventory duplicated route, durability, stream, and event declarations.
- Add an AST-backed gate that prevents new server-to-client import edges while
  grandfathering the recorded baseline.
- Record the clean-worktree typecheck baseline and generated declaration inputs.

Exit when the inventory is reproducible, every existing edge has an owner and
destination, and CI prevents the baseline from growing.

#### Phase 1: Protocol contract completion

- Move remaining serialized request, response, event, version, and taxonomy
  contracts into `packages/protocol`.
- Preserve current validation behavior and compatibility versions.
- Export contracts through explicit package subpaths.
- Add client/server parity tests for each migrated contract.

Exit when migrated consumers import only `@risuai/protocol` and the protocol
boundary audit remains clean.

#### Phase 2: Route operation and policy catalog

- Define stable operation identifiers, methods, path templates, stream classes,
  cache behavior, and durability tags.
- Derive or structurally verify `routeManifest.ts` coverage from the catalog and
  `app.printRoutes()`.
- Derive or verify the browser durable-operation allowlist from the same
  operation identifiers.
- Keep authentication and active-writer enforcement authoritative on the server;
  client metadata must not become a security authority.

Exit when every registered route has reviewed policy coverage and the client and
server operation vocabularies cannot drift silently.

#### Phase 3: Pure shared core

- Extract leaf helpers before higher-fanout domain modules.
- Move only browser/Node-neutral algorithms, normalizers, and types.
- Remove accidental Svelte, DOM, Fastify, filesystem, process-global, or database
  dependencies before moving a module.
- Add focused browser/server parity tests for moved behavior.

Exit when the shared runtime boundary has an import audit comparable to the
protocol package and no framework-specific dependency.

#### Phase 4: Server consumer migration

- Replace server imports from `src/` by domain-sized slices.
- Prefer narrow domain inputs over importing the complete browser `Database`
  type.
- Move server-only behavior into Fastify rather than forcing it through the
  shared package.
- Include server tests and browser-smoke imports in the migration scope.

Exit when production and test import inventories contain no unapproved
server-to-client edge.

#### Phase 5: Browser adapter migration

- Adopt the shared operation and wire contracts in browser adapters.
- Remove duplicate request/response validators after parity is proven.
- Generate small typed adapters only where generation reduces code and preserves
  boundary-specific error handling.

Exit when route additions and contract changes have one defined update path and
client-specific behavior remains explicit.

#### Phase 6: Typecheck and package decoupling

Completed in the cross-runtime-boundaries workstream:

- Fastify and browser-smoke no longer reference a client declaration project.
- `check:server` checks protocol/shared-core ownership before directly checking
  both downstream projects.
- The obsolete declaration configuration and generated-output contract were
  deleted.
- Decide whether a separate server package manifest now improves dependency or
  deployment ownership; do not require it for workstream success.

Exit when a clean-worktree server check needs no browser declaration build.

#### Phase 7: Verification and closeout

- Run boundary audits, protocol/shared checks, both typecheck families, focused
  parity tests, complete owning lanes, browser smoke, formatting, and diff checks.
- Update current architecture, testing, and generated-path documentation.
- Record any deliberate exceptions with owners and removal/review triggers.

### Rollback

Each moved contract or module remains independently revertible until its old
consumer path is removed. No phase may combine contract introduction, broad
consumer migration, and removal in one unreviewable change.

## Workstream 2: Canonical State and Compatibility Retirement

Suggested path: `docs/plan/canonical-state-and-compatibility/`

### Goal

Give each persisted domain one canonical internal owner. Preserve supported old
formats through explicit migration, import, export, or compatibility actions
rather than normal-runtime mirrors and fallbacks.

### End state

- Model configuration normally resolves from durable profiles and bindings.
- Prompt templates have one normal durable owner.
- Translator presets do not require normal-runtime legacy scalar mirrors.
- Ordinary command paths validate persisted state instead of opportunistically
  repairing unrelated records.
- Old saves normalize into canonical current state at a durable boundary.
- Explicit legacy exports can reconstruct required old fields without making
  those fields live internal owners.

### Non-goals

- Dropping readable old saves without an explicit compatibility decision.
- Combining data migration with client facade removal.
- Changing user-visible generation, prompt, or translation behavior beyond
  resolving ambiguous ownership.
- Treating any field as removable merely because its name contains `legacy`.

### Phases

#### Phase 0: Compatibility inventory and retention policy

- Inventory compatibility fields, tables, adapters, routes, and fallback reads.
- Classify each surface as canonical, migrate, import-only, export-only,
  explicit compatibility, quarantine, or remove.
- Lock precedence, downgrade/export, failure, and damaged-database behavior.
- Name real historical fixtures required before implementation.

Exit when every in-scope surface has one disposition and no runtime owner is
ambiguous.

#### Phase 1: Migration and recovery foundation

- Standardize versioned, idempotent, restart-safe migrations for these domains.
- Prove transaction rollback, WAL/checkpoint ordering where relevant, interrupted
  migration retry, backup/restore, and database-lineage behavior.
- Separate automatic current-schema migration from an explicit damaged-database
  recovery action.

Exit when a failed or interrupted migration cannot leave partially canonical
state and every supported historical fixture has a deterministic result.

#### Phase 2: Model configuration ownership

- Migrate usable legacy flat model selections/options into durable profiles and
  role bindings.
- Move remaining settings and authoring surfaces to durable profiles.
- Remove ordinary resolver fallback to flat fields after migration and explicit
  compatibility entrypoints are proven.
- Preserve static or external compatibility cases only when Phase 0 explicitly
  classifies them.

Exit when normal generation, memory, translation, scripting, tools, presets, and
loadouts resolve through one canonical profile contract.

#### Phase 3: Prompt-template ownership

- Make modern prompt-preset template bodies the only normal durable owner.
- Remove top-level and SQLite mirrors as mutable truth.
- Convert legacy bot-preset templates through explicit migration or extraction.
- Preserve supported legacy import/export without allowing selection to recreate
  dual ownership.

Exit when editor, hydration, generation, loadout, and command behavior use the
same owner and stale mirrors cannot affect output.

#### Phase 4: Translator and smaller compatibility mirrors

- Move all translator consumers to selected preset/step ownership.
- Remove normal-runtime synchronization of first-step legacy scalar fields.
- Process remaining small compatibility mirrors according to the Phase 0
  disposition matrix.

Exit when each migrated domain has one internal read and write contract.

#### Phase 5: Repair boundary

- Move `ensure*` repair and stable-ID repair into migration, import, or explicit
  recovery paths.
- Split repair helpers from validate-only command helpers structurally.
- Remove command-time sibling repair, ID minting, and pointer normalization unless
  a command explicitly owns that mutation.
- Add tests proving normal commands do not change unrelated records.

Exit when ordinary commands are local, deterministic, and validate-only outside
their declared mutation range.

#### Phase 6: Import, export, backup, and obsolete-storage cleanup

- Prove every supported legacy input normalizes into canonical state.
- Generate legacy output only in explicit legacy export paths.
- Update backup/restore allowlists and compatibility-file ownership.
- Remove or quarantine obsolete tables, fields, command shapes, and routes after
  all live consumers are gone.

Exit when canonical state round-trips through current backup/export and supported
legacy formats without maintaining a second runtime owner.

#### Phase 7: Verification and closeout

- Run migration, restart, rollback, fixture, backup/restore, import/export,
  provider, prompt, translation, command, browser, typecheck, formatting, and
  documentation gates.
- Record retained compatibility surfaces and their exact boundaries.

### Rollback

Each domain phase must retain an old-reader or pre-migration backup rollback path
until its post-migration read, restart, and export proofs pass. Do not remove a
compatibility field in the same slice that first establishes its replacement
migration.

## Workstream 3: Client Resource Ownership

Suggested path: `docs/plan/client-resource-ownership/`

### Goal

Complete the browser's transition from an aggregate mutable `Database` model to
explicit resource owners and command-backed mutations.

This workstream deliberately preserves the current command-event invalidation
and authoritative-read model. Event deltas belong to Workstream 4.

### End state

- New and existing application code reads explicit resource owners rather than
  `getDatabase()`.
- UI mutation paths call owner-specific commands and optimistic projection
  helpers directly.
- Bridge watchers, aggregate facade epochs, trusted-write scopes, and lifecycle
  bridge flushing are removed.
- The aggregate compatibility proxy and resource write guard are removed.
- Temporary broad resource endpoints and rollback seams have explicit removal or
  permanent-compatibility decisions.

### Non-goals

- Changing persisted ownership before Workstream 2 names the canonical owner.
- Adding patch-bearing command events.
- Redesigning the global revision, active-writer, outbox, or receipt contracts.
- Removing authoritative-read recovery.

### Phases

#### Phase 0: Consumer, facade, and bridge inventory

- Inventory `getDatabase()`, snapshot, facade-epoch, trusted-write, bridge,
  lifecycle flush, and temporary aggregate endpoint consumers.
- Assign every consumer to a resource owner and migration phase.
- Add gates preventing new aggregate reads, trusted writes, and bridge families.
- Record render, mutation, generation, hydration, draft, and recovery dependencies
  for each resource family.

Exit when every compatibility consumer has a target owner and the inventory
cannot grow silently.

#### Phase 1: Resource-owner foundation

- Fill gaps in owner-specific selectors, hydration status, commands, optimistic
  projections, draft ownership, rollback, error state, and tests.
- Define common owner APIs only where they preserve narrow reactivity and do not
  recreate an aggregate database under a new name.

Exit when later phases can migrate consumers without reaching back through the
compatibility facade.

#### Phase 2: Leaf settings and collection resources

- Start with low-fanout, stable-ID resources whose canonical owners are complete.
- Migrate reads, commands, drafts, rollback, and tests together.
- Remove each resource's compatibility mutation path when its final consumer
  moves.

Exit when the selected leaf/collection owners have no aggregate consumer or
bridge fallback.

#### Phase 3: Character and chat ownership

- Migrate character summaries/details, selection/order, chat metadata, and
  transcript consumers to explicit owners.
- Preserve lazy body hydration, generation fences, drafts, reroll alternates, and
  selected-target race behavior.
- Remove the character and chat bridge paths only after browser-smoke continuity
  is proven.

Exit when character/chat UI and generation setup do not require an aggregate
database view.

#### Phase 4: Prompt, lorebook, and script-definition ownership

- Start each resource only after its Workstream 2 canonical-owner phase closes.
- Migrate owner-scoped hydration, editors, drafts, debounced mutations, optimistic
  projection, rollback, and generation consumers.
- Remove prompt-template, lorebook, and script-definition bridge lifecycles.

Exit when these high-complexity editors and generation inputs use explicit owner
state end to end.

#### Phase 5: Broad settings and shell ownership

- Migrate remaining broad settings consumers and runtime observers.
- Replace any-resource facade epoch consumers with explicit resource sets or
  documented diagnostic subscriptions.
- Retire the settings bridge last, after all owner-specific settings paths exist.

Exit when the shell and settings surfaces no longer depend on aggregate mutation
or observation.

#### Phase 6: Facade and bridge infrastructure removal

- Delete the aggregate compatibility proxy, resource write guard, trusted-write
  API, bridge flush registry, lifecycle flushing, and dead rollback helpers.
- Remove compatibility-only tests and replace them with owner-contract tests.
- Verify no equivalent aggregate facade was introduced during migration.

Exit when resource owners are the only browser state API for server-backed data.

#### Phase 7: Temporary seam removal, verification, and closeout

- Remove or permanently classify legacy aggregate resource endpoints and rollout
  aliases.
- Measure startup, hydration, reactive wakeups, payloads, and bundle boundaries.
- Run owner, command, outbox, recovery, generation, browser, typecheck, formatting,
  and documentation gates.

### Rollback

Migrate and remove one resource family at a time. A compatibility bridge remains
available until that family's owner-specific read, mutation, failure, rollback,
reload, and browser behavior pass. The aggregate facade itself is removed only
after every family gate is green.

## Workstream 4: Replay-Safe Event Deltas

Suggested future path: `docs/plan/replay-safe-event-deltas/`

### Activation rule

Do not create this as an active workstream merely because it appears in this
roadmap. Activate it only when:

1. Shared event schemas have a stable owner from Workstream 1.
2. In-scope durable resources have canonical owners from Workstream 2.
3. The aggregate facade and relevant bridges are retired or have explicit stable
   owner semantics from Workstream 3.
4. Existing replay, gap, stale-response, and authoritative-refresh tests pass.
5. Measurements show that event-triggered reads materially affect latency,
   bandwidth, large-database behavior, observer behavior, or device handoff.

### Goal

Add selective, versioned, replay-safe resource deltas to persisted command events
where they reduce total reconciliation cost without weakening authoritative
recovery.

### End state

- A command event may carry a versioned domain delta.
- The same delta contract can be used by command responses and own SSE echoes.
- The browser applies a delta only to a loaded, untainted projection at the exact
  next revision.
- Unknown, malformed, oversized, stale, or non-contiguous deltas fall back to
  existing invalidation and authenticated reads.
- Import, restore, bulk replacement, and other unsuitable operations remain
  invalidation-only.
- Generation `message_patch` remains a separate generation-stream contract.

### Non-goals

- Generic JSON Patch over the aggregate database.
- Removing REST resource reads or replay-gap recovery.
- Making browser state independently authoritative.
- Changing single-writer semantics.
- Merging command-event deltas with generation token/message-patch replay.

### Phases

#### Phase 0: Measurement and go/no-go

- Measure event-triggered targeted reads, full refreshes, response bytes,
  reconciliation latency, unexpected fallback rates, and large-database cases.
- Measure observer and handoff scenarios separately from the current single-writer
  steady state.
- Establish thresholds for implementation, expansion, rollback, and no-action.

The phase may close the workstream with a documented no-action decision if the
benefit is immaterial.

#### Phase 1: Delta contract and safety model

- Define versioned, resource-specific operations addressed by stable IDs.
- Define revision, database-lineage, resource-owner, projection-epoch, and
  loaded-state preconditions.
- Define masking, redaction, payload caps, schema validation, forward compatibility,
  and fallback behavior.
- Explicitly prohibit generic array-index patches.

Exit when malformed or unknown deltas are provably no worse than current
invalidation behavior.

#### Phase 2: Transaction, persistence, and replay integration

- Persist the delta atomically with the domain mutation and command event.
- Preserve one revision and one replayable event per normal command mutation.
- Prove duplicate delivery, contiguous replay, restart, reconnect, gap, retention,
  and older-client behavior.
- Ensure persisted payloads never contain unmasked secrets or unbounded bodies.

Exit when the server event log is replay-safe with and without delta-aware
clients.

#### Phase 3: Command-response and own-echo unification

- Reuse the event delta schema for response-confirmed optimistic effects.
- Remove superseded local-effect certificate variants only after parity proof.
- Preserve own-echo deferral and rollback/destructive-refresh fences.

Exit when one delta definition serves command response and SSE reconciliation
without creating two authoritative paths.

#### Phase 4: Low-risk pilot resources

- Pilot selection, order, rename, pin, folder, and small settings operations.
- Compare delta application against an authoritative read at the same revision.
- Roll back to invalidation on any mismatch or material complexity increase.

Exit when pilots reduce reads and code or latency without increasing fallback or
stale-state rates.

#### Phase 5: Stable-ID collection operations

- Add create, update, delete, and reorder deltas only for canonical collections
  with stable IDs and bounded payloads.
- Keep large bodies and ambiguous compatibility operations invalidation-only.

Exit when each added domain has differential equivalence and replay coverage.

#### Phase 6: Observer and device-handoff rollout

- Prove that a relinquished writer can remain a live read-only observer.
- Prove writer takeover, epoch advancement, pending-intent handling, authoritative
  hydration, running-work reattachment, and delta continuation.
- Preserve forced-takeover recovery when the old device is unavailable.

Exit when handoff needs no multi-writer mutation and never depends solely on
delta history.

#### Phase 7: Verification, rollout, and closeout

- Run differential delta-versus-read tests, replay/gap/restart/browser tests,
  payload and fallback budgets, old-client compatibility, security review,
  formatting, typechecks, and documentation updates.
- Record which event families remain invalidation-only and why.

### Rollback

Every delta-capable event retains its existing resource invalidation key. A
client or rollout cohort can ignore the delta and use current reconciliation.
Delta rollout must therefore be independently disableable without changing the
mutation or event revision contract.

## Workstream Activation and Overlap

### Initial activation

Create Workstream 1 first and make its Phase 0 gate the initial execution cursor.
Workstream 2 Phase 0 may begin after Workstream 1 has locked protocol/shared-boundary
rules. Workstream 3 Phase 0 may inventory consumers concurrently, but runtime
migration should wait for the relevant Workstream 1 and 2 owners.

Do not create Workstream 4 as active during this initial activation.

### Allowed overlap

- Boundary extraction and canonical-state work may proceed in different domains
  after shared contract conventions are fixed.
- Canonical-state and resource-owner work may proceed concurrently for different
  resources.
- Read-only inventories, metrics, fixtures, and architecture tests may proceed
  before runtime mutation when their ownership is clear.

### Required serialization

- Do not change a resource's persisted owner while simultaneously removing its
  browser compatibility bridge in another slice.
- Do not introduce a shared contract and delete all old consumers in the same
  unreviewable batch.
- Do not combine event-delta contract introduction, broad consumer rollout, and
  invalidation fallback removal.
- Do not combine database migration with removal of the only known-good legacy
  reader or exporter.

## Shared Verification Ladder

During implementation, an agent may run `pnpm test -- <one-test-or-source-file>`
only when that focused result answers a concrete question. Phase and workstream
closeout use user/CI-owned full-suite results and record the tested commit plus
exact evidence in `latest-verification.md`.

The expected ladder is:

1. Optional agent-focused unit or integration feedback for one exact owner.
2. User/CI typecheck and architecture/import/contract results.
3. User/CI complete frontend/server, compatibility, browser-smoke, and
   performance/payload/replay results required by the phase risk.
4. Prettier, `git diff --check`, current architecture documentation, and a final
   verification record tied to the tested commit.

Agents do not run `pnpm test:all` or the component lanes behind it. The user owns
periodic aggregate execution, failure triage, and closeout acceptance.

## Portfolio Completion Criteria

The modernization portfolio is complete when:

- The first three workstreams are closed and archived with current verification.
- The server typecheck and runtime no longer depend on the browser application
  source tree.
- Cross-runtime contracts have one audited shared owner.
- Persisted domains have one normal internal representation and supported legacy
  compatibility is boundary-owned.
- Ordinary commands do not opportunistically repair unrelated state.
- The browser no longer exposes an aggregate mutable server-backed database
  facade or bridge watchers.
- Temporary aggregate endpoints and rollout seams are removed or permanently
  documented with tests.
- Workstream 4 has either closed with a measured no-action decision or delivered
  selective replay-safe deltas with authoritative fallback.
- Single-writer semantics and an eventual seamless-handoff path remain intact.
