# Alpha 2 History

Date: 2026-05-28

This file records Alpha 2 findings as buckets close. Alpha 2 is closed as of
2026-05-28; the final verdict and shared verification ladder are recorded in
[`final-audit.md`](./final-audit.md).

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

Bucket 2 followed this closeout: memory mutation active-writer coverage.

## A2F2 - Memory Mutations Bypass Active-Writer Classification

Status: **Closed 2026-05-28.**

Bucket: 2 - Memory mutation active-writer coverage.

Resolution:

- `POST /api/v1/memory/jobs` and `DELETE /api/v1/memory/jobs/:id` are now
  active-writer guarded as browser-triggered durable memory mutations.
- `POST /api/v1/generate/chat` and `POST /api/v1/generate/preview-prompt` are
  now active-writer guarded because prompt assembly can create memory chunks and
  enqueue memory jobs.
- Memory job read/list routes remain unguarded.
- The browser memory cancel helper now sends `risu-writer-session` and calls the
  shared stale-writer 423 handler. There is no browser memory job create helper
  in the current codebase.
- The browser server-chat helper now sends `risu-writer-session` and calls the
  shared stale-writer 423 handler for pre-stream failures.
- Background worker job claim/complete/retry writes remain classified as
  internal continuations of already accepted work.
- `pnpm client-thinning:audit` now checks the targeted memory/generation
  active-writer route coverage and the affected browser helper header/423 paths.

Verification:

```bash
pnpm api:test server/fastify/__tests__/activeWriter.test.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/generation.chat.test.ts -- --run
pnpm test src/ts/process/request/tests/serverMemory.test.ts src/ts/process/request/tests/serverChat.test.ts -- --run
pnpm client-thinning:audit
```

Bucket 3 followed this closeout: audit invariant broadening.

## A2F3 - Audit Proof Is Narrower Than The Stated Invariant

Status: **Closed 2026-05-28.**

Bucket: 3 - Audit invariant broadening.

Resolution:

- `util/client-thinning-audit.ts` now discovers Fastify route registrations from
  direct method calls and `route({ method, url })` objects.
- Every discovered `POST`, `PATCH`, `PUT`, and `DELETE` route must match a
  reviewed classification table.
- Routes classified as active-writer guarded independently check the production
  `activeWriter.ts` source for classifier coverage.
- Runtime/auth/read-only exemptions are explicit in
  [`decisions.md`](./decisions.md).
- The asset-walker audit now extracts every collector field from
  `server/fastify/src/risuSave/assetReferences.ts` and compares it against an
  ownership table.
- Each walked asset field is mapped to an owning command validator or, for
  `database.userIcon`, an indirect-safe selected-persona mirror path.

Verification:

```bash
pnpm client-thinning:audit
pnpm api:test server/fastify/__tests__/commands.test.ts server/fastify/__tests__/activeWriter.test.ts -- --run
```

Bucket 4 followed this closeout and closed the Alpha 2 docs/status record.

## A2F4 - Alpha 2 Docs/Status Closeout

Status: **Closed 2026-05-28.**

Bucket: 4 - Alpha 2 docs/status closeout.

Resolution:

- Created [`final-audit.md`](./final-audit.md) with the final Alpha 2 verdict,
  criterion status, and verification ladder.
- Marked all Alpha 2 findings and buckets closed.
- Updated this directory's README, open findings, closeout buckets, decisions,
  and history so they agree on the closed state.
- Updated the high-level Fastify status docs to point to the Alpha 2 closeout as
  the latest client-thinning follow-up.

Verification:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

Alpha 2 has no remaining open buckets after this closeout.
