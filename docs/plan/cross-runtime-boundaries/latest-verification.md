# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-31

## Candidate

- Implementation commit: `4162150ec`
- Shared-core predecessor: model-role resolution at `22d6799dd`
- Interleaved Workstream 2 predecessor: tokenizer ownership at `c0b8776b3`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 3 Agent-only lorebook predicate; no Agent input matching,
  activation validation, Original Risu export projection, prompt activation,
  persistence, or UI behavior changed.

## Shared-Core And Consumer Proof

- The portable Agent-only marker and predicate have an explicit dependency-free
  shared-core subpath and closed ownership/import audits.
- Focused fixtures preserve nullish handling, direct and extension markers,
  strict boolean checks, extension fallback after a false direct field, and
  input non-mutation.
- The browser Agent-input/export module, browser lorebook settings and
  processing, and Fastify lorebook filtering use the shared subpath.
- The architecture inventory records 302 root-`src` edges: 202
  production, 92 server-test, and 8 browser-smoke. Of these, 143 are
  runtime/mixed.

## Commands And Results

- Shared predicate, ownership, and import-boundary files passed 6, 1, and 2
  tests.
- Agent input, browser lorebook resource-guard, and Fastify lorebook owners
  passed 5, 11, and 79 tests.
- Architecture inventory passed at 302 edges, 20 compatibility surfaces/42
  probes, 9,889 client references/326 groups, and 56 owner-gap rows.
- Shared-core, client declarations, Fastify, browser-smoke, and root Svelte
  typechecks passed. Focused Prettier and `git diff --check` passed.

## Dependency Release And Verdict

The Agent-only lorebook predicate is released at `4162150ec`; it removed one
production runtime root-`src` edge. Independent remaining-edge review selected
the dependency-free script-model override module as the next higher-impact
neutral leaf. Phase 3 continues there; declaration decoupling and the remaining
302 edges stay open.
