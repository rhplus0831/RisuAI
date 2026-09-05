# Phase 0: Character Creation Safety

Finding: F01. Dependency: confirm the opening source; no performance baseline
prerequisite. Progress and evidence belong in [status.md](../status.md).

## Objective

Create a character, optionally with an initial chat and selection, without
deleting/reinserting existing rows or cascading away existing BardWiki data.

## Read First

- [Data and events](../../../structure/data-and-events.md) and
  [BardWiki lifecycle](../../../structure/bardwiki.md).
- `server/fastify/src/routes/commands.ts`: both character creation endpoints.
- `server/fastify/src/commands/mutations.ts`: message-free versus targeted
  transaction helpers; `server/fastify/src/repository.ts`: broad rewrite and
  targeted writer helpers.
- `server/fastify/src/bardWikiRepository.ts`: chat foreign keys and derived state.
- Existing evidence owners: `server/fastify/__tests__/commands.test.ts`,
  `server/fastify/__tests__/commandSingleRowPaths.test.ts`,
  `server/fastify/__tests__/commandMutationReceipts.test.ts`, and
  `server/fastify/__tests__/bardWikiLifecycle.test.ts`.

## Work

1. Add a focused synthetic regression at the normal HTTP boundary for each
   creation endpoint. Seed at least two existing characters/chats, messages,
   greeting translations, BardWiki settings/documents/versions, links, receipts,
   and jobs as allowed by the schema. Record exact existing row values and
   identities. The old implementation must demonstrate the F01 loss.
2. Map all chat/character foreign-key dependents and distinguish explicit table
   writes from cascades. Assert primary and derived BardWiki state directly;
   `writtenTables` is useful but insufficient by itself.
3. Replace both creation routes' `applyMessageFreeJsonCommandMutation` calls
   with a targeted transaction and append writer. Preserve duplicate
   character/chat-ID validation, character order, asset validation, initial-chat
   rules, selection/last-interaction behavior, and the existing response/event.
   Reuse writer helpers where possible. Read only the identities/order/settings
   needed to validate and commit; do not parse unrelated payloads for convenience.
4. Verify atomic failure, stale revision, durable receipt replay, and event
   ordering. Replaying an accepted create must not insert twice or emit again.
5. Keep import/restore's intentional replacement semantics separate. Inventory
   remaining callers of the broad writer as evidence; do not widen this urgent
   fix into a rewrite of every replacement operation.

## Acceptance

- Both endpoints return the same accepted contract and advance revision once.
- Every preexisting BardWiki row and required search/link projection survives;
  unrelated character/chat/message/collection rows retain their values and
  identities. Existing greeting translations also survive unchanged.
- Physical writes are limited to new character/chat rows and necessary
  settings/order/selection, plus normal revision/event/receipt infrastructure.
  Define the exact per-endpoint conditional budget in tests.
- Failed validation/commit leaves all rows and revision unchanged. Receipt replay
  has no additional writes or events beyond the existing receipt contract.
- The preservation regression fails on the opening implementation and passes
  on the fix; retaining a broad writer under a new helper name is not completion.

## Verification and Rollback

Run the exact regression through `pnpm test -- <one-test-or-source-file>`, then
the affected existing command, receipt, and BardWiki tests as separate focused
invocations. Once the fix is complete, run `pnpm test:agent` and update the
affected current guides plus `pnpm check:docs`.

Keep the change small enough to revise independently. If the targeted path is
incorrect, repair it or temporarily reject creation with a clear error; do not
restore the known destructive path as a routine rollback. This phase prevents
future deletion. Recovery of already-lost production data is a separate task
requiring evidence from that environment.
