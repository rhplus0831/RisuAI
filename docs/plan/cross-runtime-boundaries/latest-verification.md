# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-31

## Candidate

- Implementation commit: `663019ccb`
- Immediate Phase 4 predecessors: browser-smoke support isolation at
  `85b01059c` with count-gate follow-up `589d7a893`, parser character seam at
  `0fb61855a`, and shared prompt-info snapshots at `8d7bc6256`
- Phase 3 predecessor: prompt-settings vocabulary at `96e0dedfb`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 4 browser-smoke support isolation and neutral prompt-role/template
  row normalization; no router/resource behavior, prompt persistence, selection,
  rendering policy, command authority, or compatibility behavior changed.

## Server-Consumer Proof

- Startup snapshot types use the protocol telemetry owner and the smoke-only
  English fixture is parity-checked against the browser labels.
- Browser prompt role/template normalization facades and Fastify direct
  consumers use two dependency-free shared-core leaves.
- Closed ownership and exact count assertions prevent migrated imports from
  returning.
- The architecture inventory records 158 root-`src` edges: 103 production, 52
  server-test, and 3 browser-smoke. Of these, 90 are runtime/mixed.

## Commands And Results

- Browser-smoke support ownership passed 2 focused tests and all 9 browser
  scenarios. Prompt-block role, closed ownership, and template normalization
  passed 4, 4, and 5 focused tests.
- Architecture inventory passed at 158 edges, 20 compatibility surfaces/42
  probes, 9,888 client references/326 groups, and 56 owner-gap rows.
- Shared-core, client declarations, Fastify, browser-smoke, and root Svelte
  typechecks passed. Focused Prettier and `git diff --check` passed.

## Dependency Release And Verdict

Browser-smoke support isolation and both prompt normalization leaves are
released through `85b01059c`/`589d7a893` and `663019ccb`. The checked boundary
is 158 edges. Phase 4 continues with the Agent lorebook resolver; declaration
decoupling and the remaining edges stay open.
