# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-31

## Candidate

- Implementation commit: `2831411d1`
- Shared-core predecessor: Agent-only lorebook predicate at `4162150ec`
- Interleaved Workstream 2 predecessor: tokenizer ownership at `c0b8776b3`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 3 script-model overrides; no durable profile lookup, Lua
  execution, database repair, persistence, character/module command policy,
  credential, or settings behavior changed.

## Shared-Core And Consumer Proof

- Script-model override types, normalization, strict validation, role lookup,
  and immutable update behavior have an explicit dependency-free shared-core
  subpath and closed ownership/import audits.
- Focused fixtures preserve exact field/role names, whitespace/blank behavior,
  object-only normalization, unknown-key and path-qualified errors, error
  identity, fresh results, role selection, deletion, and input non-mutation.
- Seven browser and four Fastify production consumers use the shared subpath;
  `src/ts/model/scriptModelOverrides.ts` is gone.
- The architecture inventory records 298 root-`src` edges: 198
  production, 92 server-test, and 8 browser-smoke. Of these, 139 are
  runtime/mixed.

## Commands And Results

- Shared script-override differential, ownership, and import-boundary files
  passed 5, 1, and 2 tests.
- Affected selector, module, scripting, character-bridge, database-default, Lua,
  and Fastify command owners passed 1, 40, 28, 25, 27, 52, and 230 tests.
- Architecture inventory passed at 298 edges, 20 compatibility surfaces/42
  probes, 9,889 client references/326 groups, and 56 owner-gap rows.
- Shared-core, client declarations, Fastify, browser-smoke, and root Svelte
  typechecks passed. Focused Prettier and `git diff --check` passed.

## Dependency Release And Verdict

Script-model overrides are released at `2831411d1`; they removed four production
runtime root-`src` edges and one source target. Independent remaining-edge review
selected module-integration normalization as one of the last clearly justified
neutral leaves before the Phase 4 server-domain migration. Phase 3 continues
there; declaration decoupling and the remaining 298 edges stay open.
