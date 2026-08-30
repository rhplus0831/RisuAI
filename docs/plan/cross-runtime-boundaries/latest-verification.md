# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-31

## Candidate

- Implementation commit: `22d6799dd`
- Shared-core predecessor: lore hash randomization at `1b1152814`
- Interleaved Workstream 2 predecessor: tokenizer ownership at `c0b8776b3`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 3 model-role resolution; no durable profile/provider policy,
  model setting, persistence, import/export, command, credential, or UI behavior
  changed.

## Shared-Core And Consumer Proof

- Model-role constants, aliases, normalizers, inheritance metadata, and legacy
  resolution have an explicit dependency-free shared-core subpath and closed
  ownership/import audits.
- Differential fixtures preserve role/key order, aliases, trimming, invalid
  defaults, fresh allocation, strict separate-model gating, base-role override
  exclusion, auxiliary precedence, and main/aux/script fallback chains.
- Twenty browser and eight Fastify production consumers use the shared subpath;
  `src/ts/model/modelRoles.ts` is gone.
- The architecture inventory records 303 root-`src` edges: 203
  production, 92 server-test, and 8 browser-smoke. Of these, 144 are
  runtime/mixed.

## Commands And Results

- Shared model-role differential, ownership, and import-boundary files passed
  13, 1, and 2 tests.
- Affected model-profile resolver/record/UI, role routing, database defaults,
  split presets, settings surfaces, storage, loadout, and Fastify command owners
  passed focused coverage; the command owner passed 230 tests.
- Architecture inventory passed at 303 edges, 20 compatibility surfaces/42
  probes, 9,889 client references/326 groups, and 56 owner-gap rows.
- Shared-core, client declarations, Fastify, browser-smoke, and root Svelte
  typechecks passed. Focused Prettier and `git diff --check` passed.

## Dependency Release And Verdict

Model-role resolution is released at `22d6799dd`; it removed eight production
and three server-test root-`src` edges plus one source target. Independent
remaining-edge review selected the Agent-only lorebook marker predicate as the
next low-risk neutral leaf. Phase 3 continues there; declaration decoupling and
the remaining 303 edges stay open.
