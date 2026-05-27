# Phase 7: Verification Closeout

## Goal

Close the Fastify-only effort with full verification and a clean documentation trail.

## Scope

- Run the full verification ladder.
- Confirm removed platform paths are gone from scripts, source, docs, and tests.
- Confirm Fastify route tests cover retained storage, proxy, generation, memory, command, and static serving behavior.
- Archive completed phase notes.
- Update [../status.md](../status.md) and [../status/next-steps.md](../status/next-steps.md).

## Boundaries

- Do not mark the plan complete with skipped verification unless the skip has a concrete reason and owner.
- Do not keep open-ended cleanup notes in status files; convert them to explicit follow-up tasks.

## Exit Criteria

- Full verification ladder passes or documented failures have accepted follow-up ownership.
- No non-Fastify runtime support remains in project entry points.
- Removed behavior is fully listed in [../removed-and-out-of-scope.md](../removed-and-out-of-scope.md).
- `phases-completed` contains final closeout notes.

## Verification

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`
