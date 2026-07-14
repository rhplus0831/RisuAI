# Phase 0: Command Baseline

Status: complete.

Goal: repair the `buildsite` vs `build:site` mismatch before any plan phase
depends on browser smoke.

## Scope

- Update the runnable `smoke:fastify-browser` script to call `pnpm build:site`.
- Update current docs that referenced `pnpm buildsite`.
- Leave archived quotes and historical proof records untouched.

## Anchors

- `package.json`
- `README.md`
- `docs/structure/testing-and-operations.md`
- `docs/structure/frontend.md`
- `docs/structure/generated-and-legacy.md`

## Target Shape

- `pnpm smoke:fastify-browser` builds through `pnpm build:site`.
- Current docs mention `build:site`.
- Archive docs may still mention `buildsite` when recording historical state.

## Done Criteria

- [x] Package script repaired.
- [x] Current docs repaired.
- [x] `pnpm run` shows the corrected script.

## Slices

- Completed proof:
  [`slices/phase-0-command-baseline/command-baseline-proof.md`](slices/phase-0-command-baseline/command-baseline-proof.md).

## Validation

```bash
pnpm run
rg -n "buildsite|build:site|smoke:fastify-browser" \
  README.md docs package.json STRUCTURE.md AGENTS.md
```
