# Phase 6: Typecheck And Package Decoupling

Status: queued.

Depends on: Phase 4/5 import inventories contain no consumer that requires the
client declaration project.

## Objective

Remove declaration-generation coupling and prove a clean-worktree server check
is independent of browser application declarations.

## Required Work

- Remove Fastify and browser-smoke project references to
  `tsconfig.client-lib.json`.
- Remove the client declaration prerequisite from `util/check-server.ts` and
  update its orchestration tests.
- Delete obsolete declaration configuration and generated-path documentation
  only after no consumer remains.
- Verify clean and stale-artifact-free checks; do not allow an existing
  `dist/client-types` directory to mask dependency.
- Decide, but do not require, whether an independent server package manifest now
  improves dependency or deployment ownership.

## Safety Contract

This phase changes build/typecheck ownership, not runtime behavior. A green check
caused by excluded files, loosened compiler settings, or hidden declarations is
failure.

## Exit Criteria

- `pnpm check:server` succeeds from a clean worktree with no client declaration
  emit and no client project reference.
- Fastify and browser smoke still typecheck every intended source file strictly.
- Obsolete artifacts/config are removed or explicitly retained for a different
  owner.

## Validation

Focused check-server tests, clean-worktree protocol/Fastify/browser-smoke
typechecks, affected tests, `pnpm test:all` because build/configuration changes,
formatting, generated-path docs, and diff checks.
