# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-31

## Candidate

- Implementation commit: `251c9d043`
- Shared-core predecessor: legacy OpenAI model aliases at `23e5a4b30`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 3 internal-reasoning stripping leaf; no generation frame,
  translation pipeline, prompt, agent bound, persistence, revision, event,
  credential, host, or UI behavior changed.

## Shared-Core And Consumer Proof

- `stripInternalReasoning` has one dependency-free owner at
  `@risuai/shared-core/internal-reasoning` with an explicit package export and
  closed shared-core import audit.
- Differential fixtures preserve case-insensitive `Thoughts`/`think` tags,
  optional spaces/attributes, nested depth, unmatched closes, unterminated
  opens, visible joining, final trimming, and `preserveUnchanged` identity.
- Browser translator/pipeline and Fastify generation-frame, raw-translation,
  and agent-preset consumers all use the shared subpath; the old browser owner
  no longer exists.
- The architecture inventory records 324 root-`src` edges: 221 production, 95
  server-test, and 8 browser-smoke. Of these, 161 are runtime/mixed.

## Commands And Results

- Shared differential, ownership, and import-boundary files passed 13, 1, and 2
  tests.
- Browser pipeline and translator-cache owners passed 16 and 24 tests.
- Fastify generation-frame, raw-message translation, and agent-preset execution
  owners passed 2, 32, and 25 tests.
- Architecture inventory passed 10 tests and its direct gate passed 324 edges,
  19 compatibility surfaces/38 probes, 9,917 client references/325 groups, and
  56 owner-gap rows.
- Shared-core, client declarations, Fastify, browser-smoke, and root Svelte
  typechecks passed. Focused Prettier and `git diff --check` passed.

## Dependency Release And Verdict

Internal-reasoning stripping is released at `251c9d043`; three production
root-`src` edges and one source target are gone. Independent remaining-edge
reviews selected the zero-import agent-preset output reference helper as the
next narrow leaf. Phase 3 continues there; declaration decoupling and the
remaining 324 edges stay open.
