# Command Coverage

Date: 2026-05-28

## Current Proof

Server:

- `server/fastify/__tests__/commands.test.ts`
- `server/fastify/__tests__/activeWriter.test.ts`
- `server/fastify/__tests__/events.test.ts`

Browser:

- `src/ts/server/commands.test.ts`
- Domain helper tests such as `src/ts/plugins/plugins.test.ts`,
  `src/ts/process/__tests__/sendChatContext.test.ts`, and module/chat helper
  tests where command sequencing is involved.

Audit:

- `pnpm client-thinning:audit` checks conflict replay, id minting, fan-out,
  route classification, and related invariants.

## Expected Coverage Shape

For command changes, prove:

- auth rejection where applicable
- missing/invalid `baseRevision`
- stale 409 behavior
- active-writer 423 behavior when route classification changes
- validation failure without revision bump
- successful mutation with one revision bump and one command event
- rollback on throw or validation failure
- browser helper path, method, body, auth, and conflict handling

## Known Gaps

- Audit fixture/test proof is missing.
- New command families must update both server route tests and browser helper
  tests where a browser helper is added.
