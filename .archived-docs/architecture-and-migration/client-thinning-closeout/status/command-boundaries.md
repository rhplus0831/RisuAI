# Command Boundaries

Date: 2026-05-29

Status: CLOSED / stable.

The command contract is closed: command bodies carry `baseRevision`; stale
revisions return 409 with the current revision; the active-writer guard rejects
stale mutating sessions with 423; a successful JSON command bumps revision once
and emits one command event; failures roll back without a revision bump. The
major durable resource command families are covered.

Proof:

- `server/fastify/__tests__/commands.test.ts`
- `src/ts/server/commands.test.ts`

Do not reopen unless current source inventory proves drift. See
[`../plan.md`](../plan.md) for the spine.

## Verification Coverage

The former proof-only coverage shard is consolidated with its canonical status record.

Date: 2026-05-29

Status: CLOSED. The command contract (baseRevision, 409, 423 active-writer,
single revision bump, one command event, rollback) and resource families are
proven by the inventory below; see [`../status/command-boundaries.md`](command-boundaries.md).

### Proof

- `server/fastify/__tests__/commands.test.ts` — route contract and resource families.
- `server/fastify/__tests__/activeWriter.test.ts` — active-writer 423 behavior.
- `src/ts/server/commands.test.ts` — browser command helpers (path, body, auth,
  conflict handling).
- `pnpm client-thinning:audit` — conflict replay, id minting, fan-out, and route
  classification invariants.

New command families must update both the server route test and the browser
helper test in the same batch.
