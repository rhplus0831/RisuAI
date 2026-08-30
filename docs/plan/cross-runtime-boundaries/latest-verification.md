# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `3f275e9dc`
- Shared route catalog predecessor: `00e49d880797e248b967051c5c81a7d8208d231d`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 2 durable command operation catalog; no route, request body,
  outbox persistence, queue, replay, retry, rejection, authentication,
  active-writer, persistence, credential, rate-limit, cache, or handler behavior
  changed.

## Catalog And Parity Proof

- `@risuai/protocol/durable-command-operation` owns 129 stable identifiers and
  exact browser-safe method/path matchers below `/api/v1/commands`.
- The ordered opening matcher sequence exactly matches SHA-256
  `388b54057be8704bbde7bf38460fa18f7fb8a54f13c795127d57ceb5f99c0084`.
- Every reviewed example resolves to exactly one identifier. Module validation
  rejects duplicate IDs, duplicate matchers, unanchored/flagged patterns, and
  ambiguous examples.
- Durable generation submit, cancel, and retry kinds point to the matching
  shared route operation IDs while retaining the prior stricter `?`/`#` path
  exclusions and runtime operation UUIDs.
- The architecture inventory now records the shared 129-entry catalog instead
  of the deleted browser-local anonymous allowlist. The cross-runtime cursor is
  unchanged at 336 direct root-`src` edges: 233 production, 95 server-test, and
  8 browser-smoke; 173 are runtime/mixed.

## Commands And Results

- Focused protocol catalog/import-boundary, pending-outbox, generation, and
  replay suites passed: 5 files and 279 tests.
- `pnpm check:protocol` passed.
- `pnpm exec tsx util/architecture-inventory.ts` passed the 336-edge boundary,
  19-surface/38-probe compatibility, and 9,917-reference/325-group client
  ownership inventories.
- `pnpm test:affected` passed its selected protocol typecheck, 561 frontend
  files with 7,047 tests, 178 server files with 3,651 passing tests and one
  skip, and the 16-cell current compatibility harness.
- Focused Prettier check and `git diff --check` passed.

## Dependency Release And Verdict

The durable command operation catalog is released at `3f275e9dc`. Browser
outbox acceptance resolves through stable shared identifiers, and generation
intent metadata is related to shared route identifiers without moving
authority. Phase 2 remains active for browser resource, cache, generation, and
raw-generation metadata reconciliation; final Phase 2 verification is pending
that slice.
