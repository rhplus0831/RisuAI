# Chat-Variable Defaults Seam

Status: ready.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: Phase 3 shared-core close at `96e0dedfb`.

## Objective

Replace `chatVarDefaults.ts`'s aggregate browser database/character type import
with the two exact Fastify-owned inputs its deterministic parser observes.

## Boundary

- Character input: optional/null `defaultVariables` text.
- Database input: optional/null `templateDefaultVariables` text.
- Expected delta: one production type-only browser-application-model edge.

## Behavior Contract

Preserve character defaults before template defaults, first occurrence wins,
nullish/blank fallback, and the existing `parseKeyValue` syntax. Do not change
prompt scope, chat-variable storage, mutation tracking, CBS evaluation,
persistence, revisions, receipts, or events.

## Validation

Add a direct focused fixture for ordering, duplicates, and nullish values plus a
closed ownership assertion. Run both typechecks, architecture inventory,
formatting, and diff checks.

## Done When

- `chatVarDefaults.ts` no longer imports the browser aggregate declarations.
- The baseline accounts for the removed edge without a new exception.
- Parsed defaults remain byte-for-byte equivalent for existing inputs.
