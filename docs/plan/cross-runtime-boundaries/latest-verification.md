# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `23e5a4b30`
- Shared-core predecessor: regex output-size normalization at `83e8aabfa`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 3 legacy OpenAI model-alias normalization leaf;
  no route, payload, persistence, revision, event, authentication,
  active-writer, credential, host, generation, or UI behavior changed.

## Shared-Core And Consumer Proof

- `@risuai/shared-core` is private, side-effect-free, independently typechecked,
  and guarded against bare, dynamic, require, and package-escape runtime
  imports.
- The exact 30-entry legacy alias table and `normalizeLegacyOpenAIModelId` have
  one owner at `@risuai/shared-core/legacy-openai-model-aliases`.
- The shared implementation has no imports, side effects, runtime-specific
  inputs, or host behavior. Differential fixtures preserve all known mappings
  and exact pass-through for blank, whitespace, case-varied, current, and custom
  unknown identifiers.
- Browser request construction plus Fastify chat-completions, legacy-instruct,
  and Responses API adapters use the explicit subpath. A closed-world ownership
  test prevents the old browser-tree owner from returning.
- The architecture inventory now records 327 direct root-`src` edges: 224
  production, 95 server-test, and 8 browser-smoke; 164 are runtime/mixed.

## Commands And Results

- Shared legacy-alias differential and ownership tests passed 35 and 1
  tests, respectively.
- Focused Fastify chat-completions, legacy-instruct, and Responses API suites
  passed 55, 13, and 20 tests, respectively.
- The focused browser OpenAI profile-options suite passed 15 tests.
- `pnpm test -- util/architecture-inventory.test.ts` passed 10 inventory tests.
- `pnpm exec tsx util/architecture-inventory.ts` passed the 327-edge boundary,
  19-surface/38-probe compatibility, 9,917-reference/325-group client
  ownership, and 56-row owner-gap inventories.
- Shared-core TypeScript, root `pnpm check`, the client declaration prerequisite,
  Fastify TypeScript, and browser-smoke TypeScript passed.
- Focused Prettier and `git diff --check` passed.

## Dependency Release And Verdict

Legacy OpenAI model-alias normalization is released without changing stored
selections, provider dispatch, credentials, endpoints, request options, or wire
payloads. Phase 3 continues with internal-reasoning stripping; declaration
decoupling and the remaining 327 root-`src` edges remain explicitly open.
