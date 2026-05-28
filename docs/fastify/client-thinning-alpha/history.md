# History

Date: 2026-05-28

Resolved alpha findings, verification-ladder results, and closeout notes live
here. The live task list is [`open-findings.md`](./open-findings.md).

## Initial alpha handoff

Opened on 2026-05-28 from the cross-verification of:

- [`../../audit-codex.md`](../../audit-codex.md)
- [`../../audit-claude.md`](../../audit-claude.md)

Bucket 1 closed AF1 on 2026-05-28.

## Resolved findings

### Bucket 1 - Root create id validation + audit expansion

Resolved: **AF1 / AEC1**.

Public command-path root create helpers now require caller-supplied durable ids
for characters, presets, personas, translator presets, loadouts, modules, chats,
chat folders, and lorebooks. Legacy/default repair paths use separate repair
helpers, so import/bootstrap normalization can still mint ids for malformed
persisted data without weakening the command contract.

Regression proof:

- `server/fastify/__tests__/commands.test.ts` rejects missing-id POSTs for every
  public root create route and confirms the revision is not bumped.
- `util/client-thinning-audit.ts` now checks the root create helpers for
  `randomUUID()` reintroduction.

## Verification results

Bucket 1 verifier result:

- `pnpm api:test server/fastify/__tests__/commands.test.ts -- --run`: passed
  (71 tests).
- `pnpm client-thinning:audit`: passed.

Initial verifier result:

- `pnpm client-thinning:audit`: passed.

That pass is not sufficient for alpha closeout because AF1 and AF3 are audit
blind spots.

## Archived baseline

The baseline client-thinning workstream remains in
[`../client-thinning/`](../client-thinning/). Treat that directory as historical
context for the original EC1-EC7 contract. This alpha directory is the current
handoff for the newly verified follow-up findings.
