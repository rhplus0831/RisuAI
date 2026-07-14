# Slice: Command Baseline Proof

Phase: [0](../../phase-0-command-baseline.md). No runtime change.

Status: complete.

## Scope

Record the already-landed command baseline fix: current scripts and current docs
use `pnpm build:site`, and archived historical references may remain unchanged.

This slice does not reopen Phase 0 or edit archive proof records.

## Anchors

- `package.json`
- `README.md`
- `docs/structure/testing-and-operations.md`
- `docs/structure/frontend.md`
- `docs/structure/generated-and-legacy.md`
- `docs/plan/ui-state-contract-hardening/latest-verification.md`

## Target Shape

- `pnpm smoke:fastify-browser` invokes `pnpm build:site`.
- Current docs reference `build:site`.
- Archive docs may still mention `buildsite` when they quote historical state.

## Invariants

- Do not alter archived historical records solely to make the search output
  quiet.
- Treat broad `rg` output as an audit listing, not a pass/fail command.

## Done Criteria

- Package script and current docs are corrected.
- `latest-verification.md` records Phase 0 proof.

## Validation

```bash
pnpm run
rg -n "buildsite|build:site|smoke:fastify-browser" \
  README.md docs package.json STRUCTURE.md AGENTS.md
```
