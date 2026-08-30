# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-31

## Candidate

- Implementation commit: `12d2840b1`
- Shared-core predecessor: internal-reasoning stripping at `251c9d043`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 3 agent-preset output-reference leaf; no agent record,
  dependency-validation, prompt assembly, execution, output-bound,
  persistence, revision, event, credential, host, or UI behavior changed.

## Shared-Core And Consumer Proof

- Agent-preset output-reference discovery and expansion have one dependency-free
  owner at `@risuai/shared-core/agent-preset-output-references` with an explicit
  package export and closed shared-core import audit.
- Differential fixtures preserve exact token grammar, optional whitespace,
  ASCII identifier boundaries, the 64-character limit, tokens, UTF-16 indexes,
  repeated/callback order, empty replacements, and unresolved identity.
- Browser dependency resolution and Fastify prompt-variable/agent execution use
  the shared subpath; the old browser owner no longer exists.
- The maintained shared-core boundary command now includes both this ownership
  proof and the previously released internal-reasoning ownership proof.
- The architecture inventory records 322 root-`src` edges: 219 production, 95
  server-test, and 8 browser-smoke. Of these, 159 are runtime/mixed.

## Commands And Results

- Shared differential, ownership, and import-boundary files passed 13, 1, and 2
  tests; the retained internal-reasoning ownership proof also passed.
- Browser agent-preset resolution passed 11 tests.
- Fastify prompt-variable and agent-preset execution owners passed 33 and 25
  tests.
- Architecture inventory passed its direct gate at 322 edges, 20 compatibility
  surfaces/41 probes, 9,900 client references/326 groups, and 56 owner-gap rows.
- Shared-core, client declarations, Fastify, browser-smoke, and root Svelte
  typechecks passed. Focused Prettier and `git diff --check` passed.

## Dependency Release And Verdict

Agent-preset output references are released at `12d2840b1`; two production
root-`src` edges and one source target are gone. Three independent remaining-edge
reviews selected the zero-import punctuation classifier/trimmer as the next
review-sized leaf by majority, while explicitly deferring larger parser,
translator, prompt-policy, and already-isolated helpers. Phase 3 continues
there; declaration decoupling and the remaining 322 edges stay open.
