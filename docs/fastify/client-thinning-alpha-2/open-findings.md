# Open Findings

Date: 2026-05-28

These findings seed the Alpha 2 task list. They were identified after the
`client-thinning-alpha` closeout at HEAD `a7b74eb8`.

## Summary

| Finding                                                     | Severity | Criterion     | Status            | Bucket |
| ----------------------------------------------------------- | -------- | ------------- | ----------------- | ------ |
| A2F1 - Chat fork command mints ids                          | High     | A2EC1 / A2EC3 | Closed 2026-05-28 | 1      |
| A2F2 - Memory mutations bypass active-writer classification | High     | A2EC2 / A2EC3 | Closed 2026-05-28 | 2      |
| A2F3 - Audit proof is narrower than the stated invariant    | Medium   | A2EC3         | Open              | 3      |
| A2F4 - Alpha 2 docs/status closeout                         | Medium   | A2EC4         | Open              | 4      |

## A2F1 - Chat Fork Command Mints IDs

Severity: **High**

Status: **Closed 2026-05-28.** Resolved in Bucket 1 and copied to
[`history.md`](./history.md). The route now requires a client-supplied
`body.chat.id`, duplicate fork ids still fail, and rejected fork requests do not
bump the JSON revision. `pnpm client-thinning:audit` now scans public command
route handlers for route-local `randomUUID()` minting, including calls through
route-local helper functions.

Original evidence before Bucket 1:

`docs/fastify/client-thinning/README.md` says public commands validate stable
identity and that create commands require client-supplied ids. The first alpha
pass extended that rule to root create helpers, but the public chat fork route
contained a route-local fallback that minted the new fork id:

- `server/fastify/src/routes/commands.ts:2525` registers
  `POST /api/v1/commands/chats/:chatId/fork`.
- `server/fastify/src/routes/commands.ts:2532` treats missing `body.chat` as
  acceptable.
- `server/fastify/src/routes/commands.ts:2582` through `2588` creates the fork
  from the source chat and assigns `id: randomChatId(chats)`.
- `server/fastify/src/routes/commands.ts:4149` through `4160` implement
  `randomChatId` through `randomUUID()`.

The tests covered the successful fork path with a supplied `chat.id`, but not
the omitted-id fallback:

- `server/fastify/__tests__/commands.test.ts:2998` through `3012`.

Original impact: a public command path could create durable server state with
an id the client did not choose. This reopened the stable-id invariant for this
route.

Closed proof:

- `pnpm api:test server/fastify/__tests__/commands.test.ts -- --run`
- `pnpm client-thinning:audit`
- Extra verification also run: `pnpm test src/ts/server/commands.test.ts -- --run`
  and `pnpm check`.

Original required closeout:

- Make fork creation require a client-supplied fork chat id, preferably by
  requiring `body.chat.id` when the route creates a new chat.
- Add focused tests for omitted `body.chat`, missing `body.chat.id`, duplicate
  fork ids, and no revision bump on rejection.
- Extend `pnpm client-thinning:audit` so route-local command id minting is
  detected, not only helper-level `create*Record` minting.

## A2F2 - Memory Mutations Bypass Active-Writer Classification

Severity: **High**

Status: **Closed 2026-05-28.** Resolved in Bucket 2 and copied to
[`history.md`](./history.md). Memory job create/cancel, `/api/v1/generate/chat`,
and `/api/v1/generate/preview-prompt` are now active-writer guarded. The browser
memory cancel helper and server-chat helper send `risu-writer-session` and use
shared 423 handling. Worker claim/complete/retry writes are classified as
internal continuations rather than browser entrypoints.

Original evidence before Bucket 2:

The EC5 wording says only the most recently bootstrapped Fastify session may
mutate. The implemented guard covered the original closeout route list, but
memory mutation entrypoints wrote durable SQLite state and were not fully
classified:

- `server/fastify/src/routes/memoryJobs.ts:84` enqueues memory jobs through
  `POST /api/v1/memory/jobs`.
- `server/fastify/src/routes/memoryJobs.ts:160` cancels memory jobs through
  `DELETE /api/v1/memory/jobs/:id`.
- `server/fastify/src/routes/generationChat.ts:388` registers
  `POST /api/v1/generate/chat`, and prompt assembly can create memory chunks
  and jobs through `planHypaV3ChunkJobs`.
- `server/fastify/src/prompt/assemble.ts:957` calls `planHypaV3ChunkJobs`.
- `server/fastify/src/memoryChunkPlanner.ts:82` creates memory chunks, and
  `server/fastify/src/memoryChunkPlanner.ts:96` may enqueue jobs.
- Background worker internals later claim and complete jobs:
  `server/fastify/src/memoryWorker.ts:127`,
  `server/fastify/src/memorySummarizeJobHandler.ts:388`, and
  `server/fastify/src/memoryEmbedJobHandler.ts:497`.
- `server/fastify/src/activeWriter.ts:55` through `67` classifies commands,
  import, assets, backups, and legacy storage only.
- `util/client-thinning-audit.ts:142` through `149` repeats the same narrower
  known-mutation list.
- `src/ts/process/request/serverMemory.ts:109` through `124` sends auth headers
  but no `risu-writer-session` header and has no 423 handling.

Original impact: a stale tab could enqueue/cancel durable memory jobs or trigger durable
memory planning after a newer tab has become the active writer. Worker commits
may be legitimate internal follow-through, but they still need explicit
classification so the audit does not treat them as accidental bypasses.

Closed proof:

- `pnpm api:test server/fastify/__tests__/activeWriter.test.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/generation.chat.test.ts -- --run`
- `pnpm test src/ts/process/request/tests/serverMemory.test.ts src/ts/process/request/tests/serverChat.test.ts -- --run`
- `pnpm client-thinning:audit`

Original required closeout:

- Add memory job create/cancel routes to the active-writer classifier, or record
  an explicit exemption in `decisions.md` with tests proving why they are not
  durable state. Default decision: guard them.
- Classify generation-time memory planning routes. Default decision: guard any
  browser-triggered route that can create memory chunks/jobs; document worker
  processing as an internal continuation of already accepted work.
- Add the active-writer session header and 423 handling to the browser memory
  API helper.
- Add API/client tests for stale-writer 423 on memory job create and cancel.
- Extend `pnpm client-thinning:audit` so future durable mutation routes cannot
  silently fall outside the classifier.

## A2F3 - Audit Proof Is Narrower Than The Stated Invariant

Severity: **Medium**

`docs/fastify/client-thinning/README.md` and
`docs/fastify/client-thinning-alpha/README.md` describe the audit as the gate
that stops the close/reopen cycle. The current audit is useful and green, but
the Alpha 2 investigation found it still relies on narrow whitelists:

- Route-local id minting in `server/fastify/src/routes/commands.ts` is not
  covered by `checkStableIdCommandPaths`, which mainly checks selected helper
  functions in `server/fastify/src/commands/*`.
- Memory job mutation routes were invisible to the active-writer classifier
  check before Bucket 2 because both code and audit used the same narrow route
  allowlist. Bucket 2 added targeted memory/generation route discovery proof;
  Bucket 3 still owns the broader mutating-route classifier.
- `server/fastify/src/risuSave/assetReferences.ts:57` through `95` walks root
  profile/background fields, personas, character order, bot presets, modules,
  and character fields; `util/client-thinning-audit.ts:368` through `418`
  directly checks only character fields, character order, and preset image.

Several omitted asset validators appear to exist manually, for example:

- `customBackground` settings validation:
  `server/fastify/src/routes/commands.ts:4219`.
- Persona `icon` validation:
  `server/fastify/src/commands/personas.ts:195`.
- Module `assets` validation:
  `server/fastify/src/commands/modules.ts:279`.

Impact: the audit can pass while the docs claim broader invariant proof than it
actually provides. This is the same pattern that caused repeated close/reopen
cycles.

Required closeout:

- Expand the stable-id audit to include public command route files and route
  fallbacks that call `randomUUID()` or equivalent id minting. Bucket 1 added
  route-local command handler coverage for this class; Bucket 3 still owns the
  remaining active-writer route discovery and full asset-walker validator
  coverage.
- Expand active-writer audit coverage from a handwritten known-route list to a
  discovery check over Fastify mutating routes, with explicit reviewed
  exclusions.
- Expand asset-walker validation audit to enumerate every walked field and its
  owning write validator, including fields that are currently indirectly safe.

## A2F4 - Alpha 2 Docs/Status Closeout

Severity: **Medium**

The repo currently contains several closed-status docs that were true for the
previous alpha pass but are no longer sufficient after A2F1 through A2F3:

- `docs/fastify/status.md` says all phases and the alpha workstream are closed.
- `docs/fastify/status/next-steps.md` says no open findings remain.
- `docs/fastify/client-thinning-alpha/open-findings.md` is correctly empty for
  the first alpha pass, but future agents need a new live handoff source.

Impact: future task agents can start from the wrong status file and close the
same cycle again.

Required closeout:

- Keep this Alpha 2 directory as the live source while A2F3 remains open.
- After code/audit fixes land, move A2 findings to `history.md`, mark buckets
  closed, create `final-audit.md`, and update high-level status docs.
