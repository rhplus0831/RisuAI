# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `cc7cfc0fd6e5154beab6b0c19121e287a402d17e`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: TTS-synthesis contract ownership; no credential, character, or endpoint
  resolution, provider dispatch, request/response bounds, audio validation,
  error, cache, persistence, or event behavior changed.

## Contract And Inventory Proof

- `@risuai/protocol/tts-synthesis` owns schema-derived types and validators for
  five operations, four credential variants, five provider inputs, six OpenAI
  formats, and five discriminated request envelopes.
- Fourteen focused contract tests exercise the complete operation, credential,
  and format taxonomies, exact objects, invalid cross-pairings, malformed
  credentials, and nested OpenAI configuration; the two-test protocol import
  audit remains clean.
- Browser, Fastify, and structural consumers use the package contract; the
  old application-tree module was removed.
- 353 direct root-`src` edges remain across 140 importers and 73 targets.
- Lanes: 250 production, 95 server-test, 8 browser-smoke. Usage: 136 runtime, 44
  mixed, 173 type-only.
- The exact reduction is four edges: two production and two server-test.

## Commands And Results

- Focused TTS protocol/import-boundary suite — passed, 2 files and 16 tests.
- Focused Fastify TTS/structural suite — passed, 2 files and 23 tests.
- Focused browser TTS, architecture, and protocol suite — passed, 5 files and
  51 tests.
- `pnpm check:protocol`, `pnpm check:server`, and `pnpm check` — passed; the
  mandatory architecture gate reported 353 cross-runtime edges and both runtime
  typecheck families were clean.
- `pnpm test:affected -- --dry-run` — correctly escalated package-export changes
  to `pnpm test:all`.
- `pnpm test:affected` / `pnpm test:all` — all non-smoke lanes passed: 6,748
  frontend tests; 3,650 server tests with one skip; 206 UI coverage tests; 18
  compatibility-harness tests; the Realm scale test; six frontend performance
  tests; register, typecheck, formatting, and coverage gates. One smoke scenario
  exceeded its five-second reply wait on the first run.
- The exact timed-out smoke scenario passed alone in 2.1 seconds, then the
  complete browser-smoke lane passed all 41 tests in 1.5 minutes.
- `git diff --check` — passed.

## Dependency Release And Verdict

The TTS-synthesis envelope is released at `cc7cfc0fd`. Fastify retains all
credential, character, endpoint, bounds, provider, audio-validation, and error
authority. The slice passes; Phase 1 continues with the server-tool contract.
