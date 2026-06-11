# Slice: Coverage Map Profile

Phase: [5](../../phase-5-browser-smoke-and-coverage-map.md). Tooling/docs
change.

Status: complete.

## Scope

Add an opt-in UI coverage-map command/profile for critical UI integration paths.

This slice does not add coverage thresholds and does not enable coverage on
default `pnpm test`.

## Coverage Contract

The map should include relevant files under `src/lib/ChatScreens`,
`src/lib/Others`, `src/lib/SideBars`, and `src/ts/server`, and emit text,
JSON summary, and HTML reports under `coverage/ui-map`.

## Anchors

- `package.json`
- `vitest.config.ts`
- `.gitignore`
- `.prettierignore`
- `docs/structure/testing-and-operations.md`
- `docs/plan/ui-state-contract-hardening/latest-verification.md`

## Target Shape

- Add a script such as `pnpm coverage:ui-map`, or document an equivalent command
  if a script is not desired.
- Use `@vitest/coverage-v8` with focused UI test files and explicit include
  patterns.
- Emit `text`, `json-summary`, and `html` reporters to `coverage/ui-map`.
- Add `coverage/` to `.gitignore` or document cleanup after local runs.

## Invariants

- Coverage is a map, not a threshold gate.
- Do not chase percentage targets.
- Keep default test commands unchanged.

## Done Criteria

- The coverage-map workflow is runnable and documented.
- Artifact policy is clear.
- Phase 6 can run the same command by name or exact documented text.

## Validation

```bash
pnpm coverage:ui-map
git status --short
```
