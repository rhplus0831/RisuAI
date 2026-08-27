# Phase 2: Pure Node Promotion

Status: Pending Phase 1

## Objective

Move existing tests that already prove pure TypeScript behavior out of the
Svelte+Happy-DOM fallback without changing production code.

## Suggested Slice Order

1. Protocol, utilities, parsers, validation, and serialization.
2. Model/provider capability resolution and data shaping.
3. Translation, prompt, and generation helpers with no Svelte runtime.
4. Command planning, projection helpers, and state transitions that are already
   dependency-injected.
5. Remaining unambiguous N candidates discovered by Phase 0.

Keep domain-related files together when they share imports and fixtures. Use
reviewable batches rather than one repository-wide rename/allowlist edit.

## Promotion Rules

- The subject imports no `.svelte` implementation requiring transformation.
- The test does not depend on `document`, `window`, component mounting, focus,
  browser history, DOM events, or implicit Happy-DOM globals.
- Browser-like dependencies such as IndexedDB are explicit subject dependencies,
  not conveniences supplied accidentally by the environment.
- Do not replace a real dependency with a weaker mock solely to make promotion
  pass.
- Type-only imports from Svelte-named modules are allowed only when erased and
  verified in the target project.

## Exit Criteria

- Every Phase 0 unambiguous N candidate is promoted or has a recorded reason to
  remain.
- The legacy Node allowlist is reduced toward the ratified final routing model.
- All migrated tests pass repeatedly in Node and through the root runner.
- File/test counts remain accounted for by the completeness gate.
- Each slice records project and ordinary-frontend timing before and after.
- No slice introduces environment-specific false positives or removes visible
  behavior coverage.
- `../status.md` records remaining N ambiguities and the Phase 2 cumulative delta.

## Validation

- Focused promoted files under `frontend-node`
- Complete `frontend-node` project
- Complete `frontend-dom` project after ownership removal
- `pnpm test:frontend`
- `pnpm test:affected --dry-run`
- Periodic `pnpm test:all` at phase checkpoints
- `pnpm format:check`
- `git diff --check`
