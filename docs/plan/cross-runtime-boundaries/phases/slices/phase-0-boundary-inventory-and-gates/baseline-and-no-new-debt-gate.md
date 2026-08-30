# Boundary Baseline And No-New-Debt Gate

Status: complete at `b01e88b03461753afe8f573029ce2e5ab47892ef`.

Parent: [Phase 0](../../phase-0-boundary-inventory-and-gates.md)

Opening Fastify cursor: `c0df82d5240a29a33efa5995e08cc970e0147573`.

## Objective

Create the reproducible classified import baseline and fail-closed gate required
before any boundary extraction begins.

## Opening Evidence

- Exploratory research found root-`src` imports across production Fastify,
  server tests, and browser smoke; representative high-fanout consumers include
  prompt assembly, translation, generation, and compatibility structure tests.
- `tsconfig.client-lib.json` emits declarations to `dist/client-types`.
- `server/fastify/tsconfig.json` and `tsconfig.browser-smoke.json` reference that
  project, and `util/check-server.ts` builds it before both checks.
- No checked-in AST-backed server-to-browser import baseline was found.

The slice must regenerate exact counts. Exploratory counts are not acceptance
criteria and must not be copied into the permanent baseline without tool output.

## Allowed Changes

- A focused import-inventory utility and machine-readable baseline.
- Tests for parsing/classification, path aliases, dynamic imports, re-exports,
  type-only imports, and project references.
- Existing check/affected/CI orchestration only as needed to make the gate
  mandatory.
- Workstream status, phase, and verification records.

No production contract or runtime module moves belong in this slice.

## Required Classification

Every edge records consumer lane, source symbol/path, runtime versus type-only
use, category, target owner, migration phase, exception owner, and review/removal
trigger. Categories are wire contract, pure runtime behavior, browser
application model, test fixture, server-only behavior, or accidental dependency.

## Behavior Contract

- Mutations: none.
- Persistence effects: none.
- Route/event/cache behavior: none.
- Rollback: remove the gate and baseline together; no runtime rollback is needed.

## Validation

- Focused utility and gate tests.
- `pnpm check:protocol`
- `pnpm check:server`
- `pnpm test:affected`
- `pnpm format:check`
- `git diff --check`

Use the repository watcher result when it is live and valid under `AGENTS.md`.

## Done When

- The inventory is deterministic on a clean worktree and covers production,
  tests, browser smoke, dynamic/static imports, re-exports, and project refs.
- Every baseline edge has a classification, destination, and owner.
- New or widened unapproved edges fail locally and in the required quality lane.
- Baseline updates require an explicit reviewed diff.
- `status.md` records the baseline commit/counts and Phase 1/3 candidate order.

Stop if the gate cannot distinguish test-only/type-only edges without parsing
TypeScript, or if making it pass would require moving source in the same slice.

## Result

The AST-backed gate and reviewed [`baseline.json`](../../../baseline.json) are
mandatory through `pnpm check:server`. The baseline has 375 edges: 39 wire
contract, 190 pure-runtime, 134 browser-application-model, 7 test-fixture, and 5
accidental browser-support classifications. It records 373 static imports, one
re-export, one dynamic import, both declaration project references, and five
duplicated policy/resource/event catalog counts. No runtime module moved and no
route, persistence, event, cache, or payload behavior changed.
