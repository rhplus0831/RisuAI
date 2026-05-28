# Closeout Buckets

Date: 2026-05-28

This is the ordered task-agent work breakdown for Alpha 2. Each bucket closes
one or more findings from [`open-findings.md`](./open-findings.md). A bucket is
done only when code, focused tests, audit coverage, and docs are all updated.

Current status: **open.** Buckets 1, 2, and 3 are closed; the next open work
item is Bucket 4, Alpha 2 docs/status closeout.

| Order | Bucket                                 | Closes       | Status            | Primary ownership                                                                                                                                                                                                                                |
| ----- | -------------------------------------- | ------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Chat fork stable id semantics          | A2F1 / A2EC1 | Closed 2026-05-28 | `server/fastify/src/routes/commands.ts`, `server/fastify/__tests__/commands.test.ts`, `util/client-thinning-audit.ts`                                                                                                                            |
| 2     | Memory mutation active-writer coverage | A2F2 / A2EC2 | Closed 2026-05-28 | `server/fastify/src/activeWriter.ts`, `server/fastify/src/routes/memoryJobs.ts`, `server/fastify/src/routes/generationChat.ts`, `src/ts/process/request/serverMemory.ts`, active-writer/memory/generation tests, `util/client-thinning-audit.ts` |
| 3     | Audit invariant broadening             | A2F3 / A2EC3 | Closed 2026-05-28 | `util/client-thinning-audit.ts`, route/audit tests as needed                                                                                                                                                                                     |
| 4     | Alpha 2 docs/status closeout           | A2F4 / A2EC4 | Open              | `docs/fastify/client-thinning-alpha-2/*`, `docs/fastify/status.md`, `docs/fastify/status/next-steps.md`                                                                                                                                          |

## Parallelization Notes

- Buckets 1 and 3 both touch `util/client-thinning-audit.ts`; sequence them or
  coordinate carefully.
- Buckets 2 and 3 also both touch the active-writer audit classifier. Bucket 2
  has landed behavior and targeted route proof; Bucket 3 still owns broader
  structural discovery.
- Bucket 4 must close last.

## 1. Chat Fork Stable Id Semantics

Status: **Closed 2026-05-28.**

Goal: close A2F1 and make the command stable-id rule true for fork creation.

Closed implementation:

- Removed the `randomChatId(chats)` fallback and the route-local
  `randomUUID()` wrapper from the public fork command path.
- `POST /api/v1/commands/chats/:chatId/fork` now requires a fork payload with a
  non-empty `chat.id`.
- Duplicate-id rejection, folder validation, module validation, and valid
  client-supplied fork flows are covered by focused Fastify API tests.
- `util/client-thinning-audit.ts` now detects command route handlers that mint
  durable ids directly with `randomUUID()` or indirectly through route-local
  helpers.

Closed proof:

```bash
pnpm api:test server/fastify/__tests__/commands.test.ts -- --run
pnpm client-thinning:audit
```

Extra verification also run:

```bash
pnpm test src/ts/server/commands.test.ts -- --run
pnpm check
```

Omitted/missing fork ids return 400 without a revision bump, valid
client-supplied fork ids still work, duplicate ids still fail, and the audit
would fail if route-local `randomUUID()` minting is reintroduced.

## 2. Memory Mutation Active-Writer Coverage

Status: **Closed 2026-05-28.**

Goal: close A2F2.

Closed implementation:

- Add `POST /api/v1/memory/jobs` and `DELETE /api/v1/memory/jobs/:id` to the
  active-writer protected mutation set.
- Added `POST /api/v1/generate/chat` and
  `POST /api/v1/generate/preview-prompt` to the protected mutation set because
  both can reach prompt assembly memory planning.
- Kept memory job read/list routes unguarded.
- Updated `src/ts/process/request/serverMemory.ts` so the cancel helper sends
  `risu-writer-session` and calls shared 423 handling. There is no browser
  helper for memory job create in the current codebase.
- Updated `src/ts/process/request/serverChat.ts` so `/api/v1/generate/chat`
  sends `risu-writer-session` and calls shared 423 handling before opening the
  stream.
- Added stale-writer tests for memory job create, memory job cancel,
  `/api/v1/generate/chat`, and `/api/v1/generate/preview-prompt`.
- Extended `util/client-thinning-audit.ts` with targeted discovery for the
  memory/generation guarded routes and client helper header/423 checks.
- Documented worker claim/complete/retry writes as internal continuations in
  [`decisions.md`](./decisions.md).

Closed proof:

```bash
pnpm api:test server/fastify/__tests__/activeWriter.test.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/generation.chat.test.ts -- --run
pnpm test src/ts/process/request/tests/serverMemory.test.ts src/ts/process/request/tests/serverChat.test.ts -- --run
pnpm client-thinning:audit
```

Stale browser-triggered memory mutations now return 423, worker/internal writes
are documented/classified, and normal active-writer memory flows still pass.

## 3. Audit Invariant Broadening

Status: **Closed 2026-05-28.**

Goal: close A2F3 and make the audit prove the documented invariant rather than
only the previous known list. Bucket 1 already landed command route-local id
minting coverage; this bucket still owns active-writer route discovery and full
asset-walker validator ownership.

Closed implementation:

- Kept the Bucket 1 stable-id route-local command minting audit in place.
- Broadened Fastify route discovery in `util/client-thinning-audit.ts` so it
  scans direct method registrations and `route({ method, url })` registrations.
- Replaced the active-writer audit's narrow known-route filter with a reviewed
  classification table over every discovered `POST`, `PATCH`, `PUT`, and
  `DELETE` route.
- The audit now fails on any new mutating route until it is classified as
  active-writer guarded or explicitly exempt as auth/session, read-only POST,
  runtime generation, runtime proxy, or stateless helper.
- Active-writer classifications independently assert the production
  `activeWriter.ts` source covers the guarded route instead of reusing the same
  production predicate.
- Expanded asset-walker validation proof so every collector field in
  `server/fastify/src/risuSave/assetReferences.ts` is mapped to an owning
  validator or indirect-safe owner.
- Documented the deliberate mutating-route exemptions in
  [`decisions.md`](./decisions.md).

Closed proof:

```bash
pnpm client-thinning:audit
pnpm api:test server/fastify/__tests__/commands.test.ts server/fastify/__tests__/activeWriter.test.ts -- --run
```

The audit now catches unclassified Fastify mutation routes, production
active-writer classifier drift for guarded routes, and newly walked RisuSave
asset-reference fields without validator ownership.

## 4. Alpha 2 Docs/Status Closeout

Status: **Open.**

Goal: close A2F4 after Buckets 1 through 3 land.

Required implementation:

- Keep A2F1 through A2F3 recorded as closed in [`history.md`](./history.md) with
  resolved notes and proof commands.
- Mark Bucket 4 closed in this file after the final ladder passes.
- Create `final-audit.md` with the final verdict and verification ladder.
- Update `docs/fastify/status.md` and `docs/fastify/status/next-steps.md` so
  they point to this Alpha 2 closeout instead of saying no open findings remain
  prematurely.

Focused proof:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

Done when all Alpha 2 docs agree, high-level status docs agree, and the full
ladder is recorded.
