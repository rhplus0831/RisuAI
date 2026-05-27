# Phase 0: Audit And Baseline

## Goal

Create a verified baseline of local and non-Fastify support before deleting code.

## Preconditions

- This plan folder exists.
- The known 2026-05-27 audit surfaces are recorded in [../plan.md](../plan.md).

## Scope

- Confirm current package scripts and server directories.
- Confirm runtime gate call sites.
- Confirm storage and proxy legacy paths.
- Confirm service worker, preload, and bootstrap local behavior.
- Record current verification results before implementation phases begin.

## Boundaries

- Do not delete code in this phase unless it is documentation-only cleanup.
- Do not add compatibility abstractions.

## Exit Criteria

- Baseline command results are recorded.
- Any newly found platform support is added to [../removed-and-out-of-scope.md](../removed-and-out-of-scope.md).
- Phase 1 has a concrete removal list.

## Verification

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`
