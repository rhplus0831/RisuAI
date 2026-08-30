# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `58a847a11759ad7bd2764b0bdd46421690c2a505`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: embedding-operation contract ownership; no endpoint, credential or
  custom-URL resolution, provider dispatch, payload/batch/response bounds,
  vector validation, cache, persistence, or event behavior changed.

## Contract And Inventory Proof

- `@risuai/protocol/embedding-operation` owns schema-derived types and validators
  for six remote models, contextual/non-contextual subsets, two input types,
  three credential variants, two custom endpoint variants, two discriminated
  request envelopes, and two success envelopes.
- Seven focused contract tests exercise the complete taxonomy, valid request
  variants, invalid cross-pairings, exact objects, nonempty inputs, credential
  shapes, vector nesting, finite numbers, and dimension coherence; the two-test
  protocol import audit remains clean.
- Browser and Fastify consumers use the package contract; the old
  application-tree module was removed.
- 361 direct root-`src` edges remain across 144 importers and 75 targets.
- Lanes: 254 production, 99 server-test, 8 browser-smoke. Usage: 139 runtime, 44
  mixed, 178 type-only.
- The exact reduction is three edges: two production and one server-test.

## Commands And Results

- Focused embedding protocol/import-boundary suite — passed, 2 files and 9
  tests.
- Focused Fastify embedding suite — passed, 1 file and 13 tests.
- Focused browser embedding, architecture, and protocol suite — passed, 6 files
  and 26 tests.
- `pnpm check:protocol`, `pnpm check:server`, and `pnpm check` — passed; the
  mandatory architecture gate reported 361 cross-runtime edges and both runtime
  typecheck families were clean.
- `pnpm test:affected -- --dry-run` — correctly escalated package-export changes
  to `pnpm test:all`.
- `pnpm test:affected` / `pnpm test:all` — passed every lane: 6,722 frontend
  tests; 3,650 server tests with one skip; 41 browser-smoke tests; 206 UI coverage
  tests; 18 compatibility-harness tests; the Realm scale test; six frontend
  performance tests; register, typecheck, formatting, and coverage gates.
- `git diff --check` — passed.

## Dependency Release And Verdict

The embedding-operation envelope is released at `58a847a11`. Fastify retains
all credential, endpoint, bounds, provider, and vector-validation authority. The
slice passes; Phase 1 continues with the image-generation operation contract.
