# Fastify-Only Next Steps

## Current Pickup

Start with [Phase 0: Audit And Baseline](../phases/phase-0-audit-and-baseline.md).

## Immediate Tasks

1. Run and record the baseline verification ladder.
2. Confirm the removal list in [../removed-and-out-of-scope.md](../removed-and-out-of-scope.md).
3. Prepare Phase 1 edits for project-level removal surfaces.
4. Update this file after Phase 0 closes.

## Verification To Record

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## Watch Points

- Do not start deleting platform gates before Phase 0 records the baseline.
- Keep docs and package scripts aligned in the same phase as project-surface removals.
- Include localized app strings in the docs and packaging closeout, not only markdown files.
- Treat new local/non-Fastify surfaces as Phase 0 findings, not as ad hoc cleanup.
