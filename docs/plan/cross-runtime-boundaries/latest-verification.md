# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `8a1084a53f638860bb7f1a151f2e8fc98f0356a1`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: server-tool contract ownership; no tool execution, provider
  translation, prompt construction, authorization, active-writer, persistence,
  or error behavior changed.

## Contract And Inventory Proof

- `@risuai/protocol/server-tool` owns schema-derived definition, call, result,
  and round types plus the existing limits and normalizing validators.
- Thirteen focused contract tests exercise limits, normalized round trips,
  provider-safe names, duplicates, malformed and cyclic JSON, count and byte
  bounds, unavailable tools, thought signatures, and call/result identity; the
  two-test protocol import audit remains clean.
- Browser UI/completion and Fastify generation consumers use the package
  contract; the old application-tree module was removed.
- 345 direct root-`src` edges remain across 132 importers and 72 targets.
- Lanes: 242 production, 95 server-test, 8 browser-smoke. Usage: 136 runtime, 42
  mixed, 167 type-only.
- The exact reduction is eight production edges: six type-only and two mixed.

## Commands And Results

- Focused server-tool protocol/import-boundary suite — passed, 2 files and 15
  tests.
- Focused browser completion, Iris UI, and architecture suite — passed, 3 files
  and 42 tests.
- Focused Fastify completion/provider/tool suite — passed, 6 files and 353 tests.
- `pnpm check:protocol`, `pnpm check:server`, and `pnpm check` — passed; the
  mandatory architecture gate reported 345 cross-runtime edges and both runtime
  typecheck families were clean.
- `pnpm test:affected -- --dry-run` — correctly escalated package-export changes
  to `pnpm test:all`.
- `pnpm test:affected` / `pnpm test:all` — passed every lane in 4m42s: 6,761
  frontend tests; 3,650 server tests with one skip; 41 browser-smoke tests; 206
  UI coverage tests; 18 compatibility-harness tests; the Realm scale test; six
  frontend performance tests; register, typecheck, formatting, and coverage
  gates.
- `git diff --check` and exact generated-baseline comparison — passed.

## Dependency Release And Verdict

The server-tool contract is released at `8a1084a53`. Tool execution, provider
translation, prompt construction, authorization, active-writer authority,
persistence, and error policy remain with their existing owners. The slice
passes; Phase 1 continues with the client-context contract.
