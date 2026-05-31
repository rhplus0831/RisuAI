# Phase 5: Command Mutation Cost Reduction

Back to original plan:
[`server-client-protocol-stability-performance.md`](../server-client-protocol-stability-performance.md#phase-5-command-mutation-cost-reduction)

Status: planning slice.

Goal: reduce command latency for commands that do not need the full hydrated
database, without weakening the safe command transaction contract.

## Implementation Slices

### 5.1 Measurement-Based Selection

- Use Phase 0 measurements to pick the first command families.
- Prefer commands where latency is dominated by unnecessary hydrated database
  load/clone work.
- Keep high-cross-write or message-inspecting commands on the existing path.

Done when candidate command families are selected from measurements, not
guesswork.

### 5.2 Scoped Mutation Helpers

- Add scoped mutation helpers only for resources where the mutation can be
  expressed against message-free `db.json` plus targeted SQLite rows.
- Keep `db.json` message-free and durable only after SQLite commit.
- Preserve `BEGIN IMMEDIATE` serialization and `baseRevision` conflict
  behavior.

Done when there is a safe non-hydrated path for narrowly scoped command
families.

### 5.3 First Candidate Migrations

- Consider settings-like scalar updates.
- Consider presets and prompt settings that do not inspect chat messages.
- Consider plugin/module metadata updates that do not cross-write chat history.
- Keep `applyJsonCommandMutation()` as the default path for complex mutations.

Done when the first migrated family avoids `loadPersistedWithMessages()` without
changing command semantics.

### 5.4 Contract Preservation

- Preserve provider secret masking/resolution behavior when settings are in
  scope.
- Preserve one revision bump per committed command.
- Preserve one command event per revision-tracked projected mutation.
- Prevent any migrated command from emitting more than one command event for one
  revision bump.

Done when regression tests cover the protocol invariants for migrated families.

## Acceptance

- Selected commands avoid `loadPersistedWithMessages()` when they do not need
  chat messages.
- Revision conflict behavior is unchanged.
- `db.json` remains message-free and durable only after SQLite commit.
- No command emits more than one command event for one revision bump.

## Validation

- Focused command tests for each migrated family.
- `pnpm api:test`
- `pnpm client-thinning:audit`
