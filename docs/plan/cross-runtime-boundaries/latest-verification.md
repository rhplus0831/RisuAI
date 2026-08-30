# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `07abd8aa562c6486b41935b016ca30a4b40bd33f`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: display-source contract ownership; no rendering, parser/CBS, cache,
  batching, persistence, authorization, revision, active-writer, or recovery
  behavior changed.

## Contract And Inventory Proof

- `@risuai/protocol/display-source` owns schema-derived versions, layers,
  contexts, targets, requests, response variants, and namespace inputs plus
  limits, validators, and canonicalization helpers.
- Twelve focused contract tests exercise taxonomies, limits, context and nested
  dependency normalization, stable namespace serialization, all layers and
  fallback statuses, exact success responses, and rejected cross-pairings; the
  two-test protocol import audit remains clean.
- Browser parser/display and Fastify bootstrap/route/service consumers use the
  package contract; the old application-tree module and test owner were removed.
- 338 direct root-`src` edges remain across 125 importers and 70 targets.
- Lanes: 235 production, 95 server-test, 8 browser-smoke. Usage: 134 runtime, 40
  mixed, 164 type-only.
- The exact reduction is three production runtime/mixed edges.

## Commands And Results

- Focused display-source protocol/import-boundary/architecture suite — passed, 3
  files and 24 tests.
- Focused browser display/bootstrap/UI suite — passed, 3 files and 190 tests.
- Focused Fastify display/cache/bootstrap suite — passed, 3 files and 14 tests.
- `pnpm check:protocol`, `pnpm check:server`, and `pnpm check` — passed; the
  mandatory architecture gate reported 338 cross-runtime edges and both runtime
  typecheck families were clean.
- `pnpm test:affected -- --dry-run` — correctly escalated package-export changes
  to `pnpm test:all`.
- `pnpm test:affected` / `pnpm test:all` — passed every lane in 4m51s: 6,787
  frontend tests; 3,650 server tests with one skip; 41 browser-smoke tests; 206
  UI coverage tests; 18 compatibility-harness tests; the Realm scale test; six
  frontend performance tests; register, typecheck, formatting, and coverage
  gates.
- `git diff --check` and exact generated-baseline comparison — passed.

## Dependency Release And Verdict

The display-source contract is released at `07abd8aa5`. Rendering, parser/CBS
execution, caches, batching, persistence, authorization, revision checks,
active-writer policy, and recovery remain with their existing owners. The slice
passes; Phase 1 continues with the MCP OAuth refresh contract.
