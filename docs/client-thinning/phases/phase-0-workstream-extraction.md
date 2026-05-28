# Phase 0: Workstream Extraction

Date: 2026-05-28

Status: active for the initial documentation split.

## Goal

Create `docs/client-thinning/` as the active workstream folder, modeled on the
send-chat migration docs, while preserving the archived Fastify migration docs
as historical source material.

## Deliverables

- Root docs: README, note, plan, status, coverage, implementation map,
  architecture, runtime stages, and unsupported/client-owned behavior.
- Shards under `status/`, `coverage/`, `phases/`, and `prompts/`.
- First active-folder verification record after a command is actually run.

## Actionable Slices

1. Active folder skeleton.
   - Objective: create or verify the `docs/client-thinning/` root and shard
     folders listed in deliverables.
   - Scope: documentation files only; do not edit runtime code or archived
     Fastify source material.
   - Done: `README.md` and the expected `status/`, `coverage/`, `phases/`, and
     `prompts/` entries exist with a clear owner/purpose for each file.
2. Archive-to-active index.
   - Objective: map the archived Phase 9 source material into active
     workstream documents so future agents do not need to reopen the full
     archive.
   - Scope: add concise cross-references, source notes, and unresolved-work
     links in the active docs.
   - Done: every archive-derived open item has one active destination and the
     archive remains historical, not the live task list.
3. Baseline separation pass.
   - Objective: separate current code baseline, known open work, and proposed
     next steps across the root docs and shards.
   - Scope: documentation wording and organization only.
   - Done: `status.md`, `plan.md`, `coverage.md`, and
     `implementation-map.md` distinguish "current", "remaining", and "future"
     without conflicting claims.
4. Verification record.
   - Objective: capture the first active-folder verification evidence after a
     command has actually been run.
   - Scope: record the command, date, outcome, and any limitations in
     `coverage/latest-verification.md` or the relevant active status shard.
   - Done: the verification entry is reproducible from the active folder and
     does not imply runtime behavior changed.
5. Handoff check.
   - Objective: make Phase 0 ready for Phase 1 and later agents.
   - Scope: review only the active documentation surface for navigability,
     duplicate task ownership, and missing shard links.
   - Done: a future agent can choose a phase or batch from
     `docs/client-thinning/` without consulting unrelated docs first.

## Exit Criteria

- Future agents can choose a batch without opening the whole archive.
- The current code baseline, archive-derived open work, and near-term direction
  are clearly separated.
- Runtime behavior is unchanged by this phase.
