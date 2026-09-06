# Inlay-Token Matching

Status: complete at `92dde59e1`.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core punctuation trimming at `386bdd750`.

## Objective

Move the dependency-free inlay-token matcher into the audited shared-core owner
without changing browser memory rendering or Fastify memory-summary prompts.

## Source And Destination

- Source: `src/ts/util/inlayTokens.ts`.
- Destination: `@risuai/shared-core/inlay-tokens`.
- Consumers: browser HypaV3 memory processing and Fastify memory-summary prompt
  construction.

## Behavior Contract

- Preserve the exact global regex source and flags.
- Preserve the three accepted token prefixes, non-empty minimally matched body,
  same-line behavior, and literal replacement semantics.
- Preserve reusable global-regex `lastIndex` behavior across matching and
  non-matching replacements.
- Do not change asset lookup, image placeholder text, memory selection,
  summarization policy, persistence, or UI behavior.

## Validation

Shared-core import audit/typecheck; differential source/flags, accepted/rejected
token, multiline, repeated-replacement, and `lastIndex` fixtures; both owning
consumers; architecture inventory; both typechecks; formatting; and
`git diff --check`.

## Completion Record

- `inlayTokenRegex` now has one dependency-free owner at
  `@risuai/shared-core/inlay-tokens`; the old browser-tree implementation is
  removed.
- Both production consumers use the explicit subpath, removing one production
  root-`src` edge and one source target.
- Eleven differential cases plus ownership/import-boundary checks pass. The
  Fastify memory-summary prompt owner passed all seven cases.
