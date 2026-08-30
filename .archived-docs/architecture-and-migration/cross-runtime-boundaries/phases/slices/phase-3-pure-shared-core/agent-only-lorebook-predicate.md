# Agent-Only Lorebook Predicate

Status: complete at `4162150ec`.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core model-role resolution at `22d6799dd`.

## Objective

Move only the dependency-free Agent-only lorebook marker constant and predicate
into the audited shared-core owner without moving Agent input resolution,
Original Risu export projection, cloning, activation validation, database
types, or lorebook orchestration.

## Source And Destination

- Source: the marker constant and `isAgentOnlyLorebookEntry` in
  `src/ts/agentLorebookInputs.ts`.
- Destination: an explicit `@risuai/shared-core` subpath accepting a narrow
  structural entry shape.
- Consumers: the browser Agent-input/export module, browser lorebook settings,
  browser lorebook processing, and Fastify lorebook filtering.

## Behavior Contract

- Preserve `false` for nullish entries and entries without either marker.
- Preserve strict `=== true` handling for both the direct `agentOnly` field and
  the legacy misspelled `extentions.risu_agent_only` field.
- Preserve direct-field precedence only as an early success; a false direct
  field must still allow a true extension marker.
- Do not normalize truthy values, repair entries, mutate extension objects, or
  change the portable marker spelling.
- Keep input matching, scope precedence, activation validation, cloning,
  Original Risu export behavior, prompt filtering, persistence, and UI state in
  their current owners.

## Validation

Shared-core import audit/typecheck; nullish, direct-marker, extension-marker,
strict-boolean, and precedence fixtures; closed-world ownership proof for all
four production consumers; affected Agent-lorebook, lorebook resource-guard,
Fastify lorebook, and settings tests; both typechecks; architecture inventory;
formatting; and `git diff --check`.

## Done When

- All four production consumers use the shared subpath.
- Fastify lorebook filtering no longer imports the browser Agent-input module,
  removing one production runtime root-`src` edge without a new exception.
- Agent input resolution and Original Risu export behavior remain in their
  browser owner and continue using the shared predicate.

Stop if the predicate needs aggregate database types, cloning, Agent preset
records, browser stores, DOM/Svelte, Fastify, filesystem, process-global state,
credentials, persistence, or host policy.

## Release Evidence

- `@risuai/shared-core/agent-only-lorebook` owns the portable marker and strict
  predicate; the browser Agent-input/export module, browser settings and
  lorebook processing, and Fastify lorebook filter import it directly.
- Predicate, ownership, and import-boundary files passed 6, 1, and 2 tests;
  Agent input, browser lorebook resource-guard, and Fastify lorebook owners
  passed 5, 11, and 79 tests.
- One production runtime root-`src` edge left the checked inventory without
  changing the source target, which remains legitimately consumed by Fastify
  Agent input execution.
