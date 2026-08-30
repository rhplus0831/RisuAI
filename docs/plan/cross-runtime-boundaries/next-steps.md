# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [Phase 0 boundary baseline and no-new-debt gate](phases/slices/phase-0-boundary-inventory-and-gates/baseline-and-no-new-debt-gate.md).

1. Build an AST-backed inventory of static imports, dynamic imports, re-exports,
   and TypeScript project references from Fastify production, server tests, and
   browser smoke into `src/`.
2. Record type-only versus runtime use and classify every edge as wire contract,
   pure behavior, application model, test fixture, or accidental/server-only
   coupling.
3. Give every baseline edge a destination, owner, and removal/review phase.
4. Add a machine-readable baseline and a gate that rejects new or widened edges
   without yet deleting existing consumers.
5. Capture clean-worktree `pnpm check:server` inputs and the exact generated
   declaration prerequisite.

## Required Scope Before Editing

The slice must name the inventory file, gate implementation, affected-selection
integration, baseline update review rule, exact commands, and why it cannot
change runtime behavior. Keep source moves out of this first batch.

## Likely Gate Hosts

- `util/check-server.ts` and `util/check-server.test.ts`
- a focused utility and checked-in machine-readable manifest under a path chosen
  by the slice
- structural tests under `server/fastify/__tests__/`
- `util/affected-tests.ts` and `.github/workflows/quality.yml` only if the new
  gate is not already reached by an existing required lane

## Not First

- Do not remove `tsconfig.client-lib.json` or its references.
- Do not move the aggregate `Database` type into `packages/protocol`.
- Do not extract prompt, parser, provider, or translator domains before their
  leaf dependencies and behavior parity are named.
- Do not merge route authentication policy into browser metadata.
- Do not activate replay-safe event deltas.

## Handoff

When the slice passes, update [`status.md`](status.md) with the exact baseline
counts and gate commit, refresh [`latest-verification.md`](latest-verification.md),
then select one Phase 1 contract family or Phase 3 neutral leaf from the
classified inventory.
