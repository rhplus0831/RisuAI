# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Opening anchor: `c0df82d5240a29a33efa5995e08cc970e0147573`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 0 boundary baseline and no-new-debt gate; no runtime modules,
  routes, persistence, events, cache behavior, or payloads changed.

## Inventory

- 375 direct browser-tree edges across 148 importers and 79 targets.
- Lanes: 260 production, 107 server-test, 8 browser-smoke.
- Usage: 147 runtime, 46 mixed, 182 type-only.
- Syntax: 373 static imports, 1 re-export, 1 dynamic import.
- Classifications: 39 wire contract, 190 pure runtime, 134 browser application
  model, 7 test fixture, 5 accidental browser-support.
- Project references: Fastify and browser-smoke both reference
  `tsconfig.client-lib.json`; the declaration prerequisite remains intentionally
  grandfathered until Phase 6.
- Duplicated metadata observations: 103 server route-policy entries, 257 literal
  route registrations, 129 browser durable-operation patterns, 59 browser
  resource surfaces, and 146 server command-event catalog entries.

## Commands And Results

- `pnpm exec vitest run util/architecture-inventory.test.ts util/check-server.test.ts`
  — passed, 2 files and 9 tests.
- `pnpm exec tsx util/architecture-inventory.ts` — passed with the 375-edge
  checked baseline.
- `pnpm check:protocol` — passed.
- `pnpm check:server` — passed protocol, architecture inventory, client
  declaration, Fastify, and browser-smoke checks.
- `pnpm test:affected --dry-run` — selected the affected frontend tests.
- `pnpm test:affected` — passed, 2 files and 9 tests.
- `pnpm format:check` — passed.
- `git diff --check` — passed.

## Dependency Release And Verdict

The Phase 0 package/dependency conventions and mandatory no-new-debt gate are
released to Workstreams 2 and 3 at `b01e88b03`. Per-contract runtime migration
remains gated on the matching Phase 1 or Phase 2 release. Phase 0 passes; Phase
1 shell and character-summary resource contracts are the next cursor.
