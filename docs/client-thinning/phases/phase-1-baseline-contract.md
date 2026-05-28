# Phase 1: Baseline Contract

Date: 2026-05-28

Status: mostly complete; update only when source inventory changes the
invariant.

## Current Boundary

- Fastify owns durable state in JSON, SQLite, assets, backups, and active
  server storage routes.
- Browser code sees a projection and sends revision-checked commands for
  durable writes.
- Active-writer ownership protects server-owned mutation routes.
- Provider dispatch is server-routed in Fastify mode for supported providers.
- Browser-only effects and plugin runtime execution remain client-owned.

## Remaining

- Keep the active docs synchronized with current source when new invariant
  families are discovered.
- Make sendChat prompt/post-generation boundaries explicit before deleting any
  local branch.

## Actionable Slices

1. Source-backed boundary refresh.
   - Objective: Reconfirm the five `Current Boundary` bullets against the
     current source map before later phases make runtime changes.
   - Scope: Inspect the bootstrap, command, active-writer, projection guard,
     provider dispatch, browser-effect, plugin-runtime, and audit entry points
     named in `implementation-map.md`; do not change runtime code.
   - Proof: Each boundary bullet is either still source-backed or has a named
     drift note routed to Phase 2, Phase 3, or Phase 4.
2. Cross-doc contract alignment.
   - Objective: Keep `status.md`, `plan.md`, and `implementation-map.md`
     consistent about the baseline owner, mutation path, and proof path.
   - Scope: Update only stale or contradictory baseline wording; leave detailed
     inventories in their canonical status and coverage shards.
   - Proof: A future agent can pick any boundary claim and find the same owner
     and proof direction in all three root docs.
3. sendChat boundary inventory.
   - Objective: Make the prompt assembly and post-generation boundary explicit
     enough that Phase 4 can remove or protect one branch at a time.
   - Scope: Classify `sendChat` prompt fallback, server-backed prompt
     assembly, generation result persistence, scriptstate/message patches, and
     display/browser effects as server-owned, client-owned, or Phase 4
     candidate work.
   - Proof: No local prompt or post-generation branch is marked removable
     without a named server route/helper and fixture or route-test proof.
4. Client-owned and no-port confirmation.
   - Objective: Preserve the baseline distinction between durable state
     ownership and browser-owned behavior.
   - Scope: Compare client-owned unsupported docs with the implementation map
     for rendering, navigation, browser media APIs, plugin runtime execution,
     and removed or unsupported runtimes.
   - Proof: Client-owned behavior remains documented as intentional, and any
     newly discovered durable mutation is moved to a later invariant batch.
5. Phase 1 handoff note.
   - Objective: Leave the baseline contract ready for downstream task agents.
   - Scope: Summarize any boundary wording changes, deferred drift, and proof
     command actually run during the Phase 1 pass.
   - Proof: The phase can exit when the root docs agree and downstream Phase 2,
     Phase 3, or Phase 4 work can name its owner and proof path before editing.

## Exit Criteria

- `status.md`, `plan.md`, and `implementation-map.md` agree on the boundary.
- New task agents can identify the owner and proof path before editing.
