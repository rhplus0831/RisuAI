# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-31

## Candidate

- Implementation commit: `0fb61855a`
- Immediate Phase 4 predecessors: shared prompt-info snapshots at `8d7bc6256`,
  shared toggle-preset records at `3153c7d14`, shared memory-model capability at
  `c51dcac16`, and parser chat-variable injection at `5e7233e2a`
- Phase 3 predecessor: prompt-settings vocabulary at `96e0dedfb`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 4 Lua runtime character-argument type ownership; no parser state,
  Lua conversion, CBS registration, matcher dispatch, persistence, policy, or
  event behavior changed.

## Server-Consumer Proof

- Fastify Lua runtime owns the three-field structural character input that it
  consumes and no longer imports the browser parser declaration.
- Closed ownership and exact count assertions prevent migrated imports from
  returning.
- The architecture inventory records 163 root-`src` edges: 105 production, 52
  server-test, and 6 browser-smoke. Of these, 93 are runtime/mixed.

## Commands And Results

- Lua runtime ownership and behavior suites passed 1 and 52 tests.
- Architecture inventory passed 10 tests at 163 edges, 20 compatibility
  surfaces/42 probes, 9,899 client references/326 groups, and 56 owner-gap rows.
- Shared-core, client declarations, Fastify, browser-smoke, and root Svelte
  typechecks passed. Focused Prettier and `git diff --check` passed.

## Dependency Release And Verdict

The parser character-argument type seam is released through `0fb61855a`; it
preserves browser parser and Fastify Lua behavior while reducing the checked
boundary to 163 edges. Phase 4 continues with browser-smoke support boundaries;
declaration decoupling and the remaining edges stay open.
