# Closeout Buckets

Date: 2026-05-28

This is the ordered task-agent work breakdown for Alpha 2. Each bucket closes
one or more findings from [`open-findings.md`](./open-findings.md). A bucket is
done only when code, focused tests, audit coverage, and docs are all updated.

Current status: **open.** Bucket 1 is closed; the next open work item is
Bucket 2, memory mutation active-writer coverage.

| Order | Bucket                                 | Closes       | Status            | Primary ownership                                                                                                                                                                                                                                |
| ----- | -------------------------------------- | ------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Chat fork stable id semantics          | A2F1 / A2EC1 | Closed 2026-05-28 | `server/fastify/src/routes/commands.ts`, `server/fastify/__tests__/commands.test.ts`, `util/client-thinning-audit.ts`                                                                                                                            |
| 2     | Memory mutation active-writer coverage | A2F2 / A2EC2 | Open              | `server/fastify/src/activeWriter.ts`, `server/fastify/src/routes/memoryJobs.ts`, `server/fastify/src/routes/generationChat.ts`, `src/ts/process/request/serverMemory.ts`, active-writer/memory/generation tests, `util/client-thinning-audit.ts` |
| 3     | Audit invariant broadening             | A2F3 / A2EC3 | Open              | `util/client-thinning-audit.ts`, route/audit tests as needed                                                                                                                                                                                     |
| 4     | Alpha 2 docs/status closeout           | A2F4 / A2EC4 | Open              | `docs/fastify/client-thinning-alpha-2/*`, `docs/fastify/status.md`, `docs/fastify/status/next-steps.md`                                                                                                                                          |

## Parallelization Notes

- Buckets 1 and 3 both touch `util/client-thinning-audit.ts`; sequence them or
  coordinate carefully.
- Buckets 2 and 3 also both touch the active-writer audit classifier. If split
  across agents, Bucket 2 should own behavior and Bucket 3 should own structural
  discovery.
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

Status: **Open.**

Goal: close A2F2.

Required implementation:

- Add `POST /api/v1/memory/jobs` and `DELETE /api/v1/memory/jobs/:id` to the
  active-writer protected mutation set.
- Classify `POST /api/v1/generate/chat` and any other browser-triggered route
  that can create memory chunks/jobs through prompt assembly. Default behavior:
  guard browser-triggered durable memory planning, while documenting worker
  claim/complete/retry writes as internal continuations.
- Update the browser memory API helper to send `risu-writer-session` on memory
  job create/cancel requests and to use the shared 423 stale-session handling.
  Do the same for any client helper that calls a newly guarded generation-time
  memory planning route.
- Add stale-writer tests that bootstrap session A, bootstrap session B, then
  prove session A receives 423 on memory job create, cancel, and any guarded
  generation-time memory planning entrypoint.
- Keep memory job read/list routes unguarded.
- Extend `util/client-thinning-audit.ts` so memory job mutation routes are part
  of the active-writer invariant and worker/internal writes are explicitly
  classified.

Focused proof:

```bash
pnpm api:test server/fastify/__tests__/activeWriter.test.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/generation.chat.test.ts -- --run
pnpm test src/ts/process/request/tests/serverMemory.test.ts -- --run
pnpm client-thinning:audit
```

Done when stale browser-triggered memory mutations are rejected with 423, worker
internal writes are documented/classified, and normal active-writer memory flows
still pass.

## 3. Audit Invariant Broadening

Status: **Open.**

Goal: close A2F3 and make the audit prove the documented invariant rather than
only the previous known list. Bucket 1 already landed command route-local id
minting coverage; this bucket still owns active-writer route discovery and full
asset-walker validator ownership.

Required implementation:

- Stable ids: scan public command route code for route-local id minting used by
  durable command mutations. Allow import/bootstrap repair helpers only when the
  path is explicitly classified as repair, not command write.
- Active writer: discover mutating Fastify routes and compare them against
  guarded, read-only/runtime-only, and explicitly exempt classifications. Do not
  let the implementation and audit silently share the same incomplete allowlist.
- Asset walker: enumerate every field collected by
  `risuSave/assetReferences.ts` and map it to an owning command validator or a
  documented indirect-safe path.
- Document any deliberate exemption in [`decisions.md`](./decisions.md).

Focused proof:

```bash
pnpm client-thinning:audit
pnpm api:test server/fastify/__tests__/commands.test.ts server/fastify/__tests__/activeWriter.test.ts -- --run
```

Done when the audit catches the A2F1/A2F2 classes structurally and fully
documents asset-walker validator ownership.

## 4. Alpha 2 Docs/Status Closeout

Status: **Open.**

Goal: close A2F4 after Buckets 1 through 3 land.

Required implementation:

- Move A2F1 through A2F3 from [`open-findings.md`](./open-findings.md) into a
  new `history.md` with resolved notes and proof commands.
- Mark buckets closed in this file.
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
