# Alpha 2 History

Date: 2026-05-28

This file records Alpha 2 findings as buckets close. The live handoff remains
[`open-findings.md`](./open-findings.md) and [`closeout-buckets.md`](./closeout-buckets.md)
until all buckets are closed.

## A2F1 - Chat Fork Command Mints IDs

Status: **Closed 2026-05-28.**

Bucket: 1 - Chat fork stable id semantics.

Resolution:

- `POST /api/v1/commands/chats/:chatId/fork` now requires a client-supplied
  fork chat payload with a non-empty `chat.id`.
- The public fork route no longer falls back to `randomChatId(chats)` or a
  route-local `randomUUID()` wrapper.
- Missing `body.chat`, missing `body.chat.id`, and duplicate fork ids return
  400 without bumping the JSON revision.
- The browser command helper type now requires a fork chat payload.
- `pnpm client-thinning:audit` now checks command route handlers for direct
  `randomUUID()` minting and calls to route-local helpers that reach
  `randomUUID()`.

Verification:

```bash
pnpm api:test server/fastify/__tests__/commands.test.ts -- --run
pnpm client-thinning:audit
pnpm test src/ts/server/commands.test.ts -- --run
pnpm check
```

Next open bucket after this closeout: Bucket 2, memory mutation active-writer
coverage.
