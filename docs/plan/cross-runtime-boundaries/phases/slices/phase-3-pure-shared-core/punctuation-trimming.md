# Punctuation Trimming

Status: complete at `386bdd750`.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core agent-preset output references at `12d2840b1`.

## Objective

Move the dependency-free punctuation classifier and incomplete-response suffix
trimmer into the audited shared-core owner without changing browser or Fastify
post-generation behavior.

## Source And Destination

- Source: `src/ts/util/punctuation.ts`.
- Destination: an explicit `@risuai/shared-core` subpath.
- Browser consumers: the `src/ts/util.ts` compatibility re-export plus stream
  and non-stream post-generation response handling.
- Fastify consumers: prompt assembly and the generation-chat route.

## Behavior Contract

- Preserve `s.trim().at(-1)` classification, including empty and whitespace-only
  strings.
- Preserve the exact ASCII punctuation table and Unicode code-unit ranges.
- Preserve code-unit suffix removal until the remaining last trimmed character
  classifies as punctuation.
- Do not trim, normalize, coerce, or rewrite the returned prefix beyond the
  existing loop.
- Keep the browser `src/ts/util.ts` export stable for existing callers and
  mocks; only its implementation owner changes.

## Validation

Shared-core import audit/typecheck; copied historical/current differential
fixtures for empty, whitespace, ASCII, Unicode punctuation, combining marks,
and incomplete suffixes; browser stream/non-stream owners; Fastify prompt
assembly and generation-chat owners; both typechecks; architecture inventory;
formatting; and `git diff --check`.

## Done When

- All four direct production consumers reach the shared leaf.
- The browser implementation file is deleted while the existing utility facade
  continues to export both symbols.
- Both matching Fastify root-`src` edges disappear without a new exception.
- Differential fixtures match the pre-extraction and historical behavior.

Stop if a consumer requires response-stream state, prompt assembly, provider
policy, Svelte, Fastify, or host-specific behavior in the shared module.

## Completion Record

- Both functions now have one dependency-free owner at
  `@risuai/shared-core/punctuation`; the browser utility facade re-exports that
  owner and the old implementation file is removed.
- All four direct browser/Fastify consumers use the shared leaf. The two
  matching Fastify root-`src` edges and one source target are gone.
- Twenty differential cases preserve the punctuation table, Unicode ranges,
  whitespace, combining marks, UTF-16 slicing, and untrimmed prefix. Shared
  ownership/import checks, browser stream/non-stream owners, Fastify assembly,
  and all 181 generation-chat cases passed.
