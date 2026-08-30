# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `159b6eccfd508b1b77300c6597cdbc15b31470a9`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: shell and character-summary resource contract ownership; no route,
  payload, cache, authentication, active-writer, persistence, revision, event,
  or recovery behavior changed.

## Contract And Inventory Proof

- TypeBox schemas and derived types live at the explicit
  `@risuai/protocol/shell-resource` and
  `@risuai/protocol/character-summary-resource` subpaths.
- Seventeen focused protocol/import-boundary tests cover exact fields, versions,
  malformed values, detail-field rejection, list coherence, unique identities,
  chat membership, and nested revision coherence.
- Fastify routes/repository/tests and browser resource/cache consumers use the
  package contracts; the old application-tree modules have no consumer and were
  removed.
- 367 direct root-`src` edges remain across 147 importers and 77 targets.
- Lanes: 257 production, 102 server-test, 8 browser-smoke. Usage: 141 runtime,
  44 mixed, 182 type-only.
- The exact reduction is eight edges: three production and five server-test.

## Commands And Results

- Focused protocol/import-boundary suite — passed, 3 files and 17 tests.
- Owning browser resource/hydration/invalidation/manifest suite — passed, 4
  files and 168 tests.
- Owning Fastify resource/payload/load-cost suite — passed, 3 files and 61 tests.
- `pnpm check:protocol`, `pnpm check:server`, and `pnpm check` — passed; the
  mandatory architecture gate reported 367 cross-runtime edges and both runtime
  typecheck families were clean.
- `pnpm test:affected -- --dry-run` — correctly escalated package-export changes
  to `pnpm test:all`.
- `pnpm test:affected` / `pnpm test:all` — passed every lane: 6,705 frontend
  tests; 3,650 server tests with one skip; 41 browser-smoke tests; 206 UI coverage
  tests; 18 compatibility-harness tests; the Realm scale test; six frontend
  performance tests; register, typecheck, formatting, and coverage gates.
- `git diff --check` — passed.

## Dependency Release And Verdict

The shell and character-summary contracts are released to Workstream 3 at
`159b6eccf`. Their move preserved wire and authority behavior and reduced the
checked boundary exactly as planned. The slice passes; Phase 1 continues with
the provider operation contract.
