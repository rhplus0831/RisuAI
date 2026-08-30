# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `6a6d0ac1f75c5df1140bcd71729c75235ea0271e`
- Durable command catalog predecessor: `3f275e9dc`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 2 browser operation metadata reconciliation; no route, method,
  request, response, cache header, stream, retry, persistence, revision, event,
  authentication, active-writer, credential, rate-limit, host, or handler
  behavior changed.

## Browser Relation And Parity Proof

- The browser manifest owns 55 non-authoritative links to stable shared route
  IDs: 31 resource, 12 cache/transport, 10 generation, and 2 raw-generation
  relations.
- Seven explicit non-overlaps preserve browser-only purposes, requirement and
  cache identities, runtime generation UUIDs, diagnostic caller labels,
  capability callsite inventory, and the currently unused dedicated
  preview-prompt adapter.
- Validation rejects duplicate keys or family mappings, stale route IDs,
  method/path mismatches, contradictory cache/stream/durability/response
  metadata, missing owners, and unreviewed non-overlap reasons.
- The two direct bulk `{ids}` POST reads are now correctly classified as
  `unspecified` rather than request-hash cached. Browser requests and Fastify
  behavior were unchanged.
- The architecture inventory now records both browser relation catalogs. The
  cross-runtime cursor remains 336 direct root-`src` edges: 233 production, 95
  server-test, and 8 browser-smoke; 173 are runtime/mixed.

## Commands And Results

- Focused route/resource/hydration/generation/raw-caller suites passed: 7 files
  and 142 tests.
- Focused Fastify route-policy coverage passed: 1 file and 17 tests.
- `pnpm check:protocol` and `pnpm check` passed with zero Svelte diagnostics.
- `pnpm exec tsx util/architecture-inventory.ts` passed the 336-edge boundary,
  19-surface/38-probe compatibility, and 9,917-reference/325-group client
  ownership inventories.
- `pnpm test:watch:status` passed for the current worktree. The immediately
  preceding complete affected run also passed 561 frontend files with 7,047
  tests, 178 server files with 3,651 passing tests and one skip, and the 16-cell
  current compatibility harness.
- Focused Prettier check and `git diff --check` passed.

## Dependency Release And Verdict

Browser resource, cache, generation, and raw-generation vocabularies are joined
to the shared route catalog at `6a6d0ac1f` without moving authority. Phase 2 is
closed, and Phase 3 pure shared-core work may begin with the audited first-leaf
slice.
