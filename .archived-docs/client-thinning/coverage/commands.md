# Command Coverage

Date: 2026-05-29

Status: CLOSED. The command contract (baseRevision, 409, 423 active-writer,
single revision bump, one command event, rollback) and resource families are
proven by the inventory below; see [`../status/command-boundaries.md`](../status/command-boundaries.md).

## Proof

- `server/fastify/__tests__/commands.test.ts` — route contract and resource families.
- `server/fastify/__tests__/activeWriter.test.ts` — active-writer 423 behavior.
- `src/ts/server/commands.test.ts` — browser command helpers (path, body, auth,
  conflict handling).
- `pnpm client-thinning:audit` — conflict replay, id minting, fan-out, and route
  classification invariants.

New command families must update both the server route test and the browser
helper test in the same batch.
