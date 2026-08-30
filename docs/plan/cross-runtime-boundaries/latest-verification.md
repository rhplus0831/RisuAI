# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `054116c5d27235b124b12a2f84b1c6d6c827ea5a`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: image-generation contract ownership; no credential or endpoint
  resolution, provider/Lua dispatch, payload/response bounds, image validation,
  error, asset, cache, persistence, or event behavior changed.

## Contract And Inventory Proof

- `@risuai/protocol/image-generation-operation` owns schema-derived types and
  validators for eight providers, three credential variants, and eight
  discriminated request envelopes.
- Twelve focused contract tests exercise the complete taxonomy and request
  variants, exact objects, invalid cross-pairings, credentials, nested LoRA and
  image arrays, and opaque-object NovelAI payload behavior; the two-test protocol
  import audit remains clean.
- Browser, Fastify, Lua, and structural consumers use the package contract; the
  old application-tree module was removed.
- 357 direct root-`src` edges remain across 142 importers and 74 targets.
- Lanes: 252 production, 97 server-test, 8 browser-smoke. Usage: 138 runtime, 44
  mixed, 175 type-only.
- The exact reduction is four edges: two production and two server-test.

## Commands And Results

- Focused image protocol/import-boundary suite — passed, 2 files and 14 tests.
- Focused Fastify image/structural suite — passed, 2 files and 26 tests.
- Focused browser image, architecture, and protocol suite — passed, 5 files and
  39 tests.
- `pnpm check:protocol`, `pnpm check:server`, and `pnpm check` — passed; the
  mandatory architecture gate reported 357 cross-runtime edges and both runtime
  typecheck families were clean.
- `pnpm test:affected -- --dry-run` — correctly escalated package-export changes
  to `pnpm test:all`.
- `pnpm test:affected` / `pnpm test:all` — passed every lane: 6,734 frontend
  tests; 3,650 server tests with one skip; 41 browser-smoke tests; 206 UI coverage
  tests; 18 compatibility-harness tests; the Realm scale test; six frontend
  performance tests; register, typecheck, formatting, and coverage gates.
- `git diff --check` — passed.

## Dependency Release And Verdict

The image-generation envelope is released at `054116c5d`. Fastify retains all
credential, endpoint, bounds, provider, Lua, image-validation, and asset
authority. The slice passes; Phase 1 continues with the TTS synthesis contract.
