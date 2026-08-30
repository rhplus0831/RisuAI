# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `4f6e0ef1bd812bc025a7e4ac126938e241fd02f9`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: MCP OAuth refresh request/success DTO ownership; no credential,
  identity/URL, egress, rotation, timeout, bounds, parsing, cancellation, error,
  or masking behavior changed.

## Contract And Inventory Proof

- `@risuai/protocol/mcp-oauth-refresh` owns exact schema-derived stored-refresh
  request and access-token success envelopes plus runtime shape guards.
- Four contract fixtures exercise valid request identities at the shape layer,
  exact success, and missing, malformed, or additive fields; the two-test
  protocol import audit remains clean.
- Browser and Fastify consumers use the package contract; the old
  application-tree DTO module was removed.
- 337 direct root-`src` edges remain across 124 importers and 69 targets.
- Lanes: 234 production, 95 server-test, 8 browser-smoke. Usage: 134 runtime, 40
  mixed, 163 type-only.
- The exact reduction is one production type-only edge.

## Commands And Results

- Focused protocol/browser/import-boundary/architecture suite — passed, 4 files
  and 18 tests.
- Focused Fastify MCP OAuth refresh suite — passed, 1 file and 18 tests.
- `pnpm check:protocol`, `pnpm check:server`, and `pnpm check` — passed; the
  mandatory architecture gate reported 337 cross-runtime edges and both runtime
  typecheck families were clean.
- `pnpm test:affected` correctly escalated package-export changes to
  `pnpm test:all` and passed every lane in 4m54s: 6,791 frontend tests; 3,650
  server tests with one skip; 41 browser-smoke tests; 206 UI coverage tests; 18
  compatibility-harness tests; the Realm scale test; six frontend performance
  tests; register, typecheck, formatting, and coverage gates.
- `git diff --check` and exact generated-baseline comparison — passed.

## Dependency Release And Verdict

The MCP OAuth refresh contract is released at `4f6e0ef1b`. Credentials,
identity/URL validation, egress, token rotation, timeouts, bounds, parsing,
cancellation, errors, and masking remain with their existing owners. The slice
passes; Phase 1 continues with the standalone-settings contract.
