# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `83e8aabfa`
- Shared-core predecessor: chat display-tail normalization at `6fc15d7a1`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 3 regex output-size normalization leaf;
  no route, payload, persistence, revision, event, authentication,
  active-writer, credential, host, generation, or UI behavior changed.

## Shared-Core And Consumer Proof

- `@risuai/shared-core` is private, side-effect-free, independently typechecked,
  and guarded against bare, dynamic, require, and package-escape runtime
  imports.
- The `16` MiB default, `1..64` MiB bounds,
  `normalizeRegexOutputSizeLimitMiB`, and `regexOutputSizeLimitCodeUnits` have
  one owner at `@risuai/shared-core/regex-output-size-limit`.
- The shared implementation has no imports, side effects, runtime-specific
  inputs, or host behavior. Differential fixtures preserve numeric-only input,
  non-finite fallback, truncation, clamping, and MiB-to-code-unit conversion.
- Fastify defaulting, command validation, bounded-regex and script execution,
  plus browser storage, settings, scripts, and worker runtime use the explicit
  subpath. A closed-world ownership test prevents the old browser-tree owner
  from returning.
- The architecture inventory now records 330 direct root-`src` edges: 227
  production, 95 server-test, and 8 browser-smoke; 167 are runtime/mixed.

## Commands And Results

- Shared regex output-size differential and ownership tests passed 18 and 1
  tests, respectively.
- `pnpm test -- server/fastify/__tests__/databaseDefaults.test.ts` passed 24
  Fastify defaulting tests.
- Focused Fastify bounded-regex, script, and command suites passed 15, 58, and
  230 tests, respectively.
- Focused browser storage, advanced-settings, and regex-script cache suites
  passed 135, 8, and 9 tests, respectively.
- `pnpm test -- util/architecture-inventory.test.ts` passed 10 inventory tests.
- `pnpm exec tsx util/architecture-inventory.ts` passed the 330-edge boundary,
  19-surface/38-probe compatibility, 9,917-reference/325-group client
  ownership, and 56-row owner-gap inventories.
- Shared-core TypeScript, root `pnpm check`, the client declaration prerequisite,
  Fastify TypeScript, and browser-smoke TypeScript passed.
- Focused Prettier and `git diff --check` passed.

## Dependency Release And Verdict

Regex output-size normalization is released without changing settings,
commands, persistence, payloads, regex execution, or worker behavior. Phase 3
continues with legacy OpenAI model-alias normalization; declaration decoupling
and the remaining 330 root-`src` edges remain explicitly open.
