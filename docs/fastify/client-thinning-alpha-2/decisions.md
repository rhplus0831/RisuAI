# Decisions

Date: 2026-05-28

Starting decisions for the Alpha 2 task list. Update this file if a bucket
chooses a different implementation and lands tests proving the new contract.

## A2EC1 - Chat Fork Stable Ids

**Default decision:** public chat fork creation follows the same command-path
stable-id rule as public create commands. The client supplies the fork chat id;
the server validates it and rejects missing or duplicate ids.

**Landed 2026-05-28:** Bucket 1 chose the default decision. The public fork
route now requires `body.chat.id`, rejects omitted/missing ids before mutation,
keeps duplicate-id rejection, and the audit checks command route handlers for
route-local id minting.

**Why:** The standing invariant depends on the browser owning optimistic durable
ids for command writes. A route-local `randomUUID()` fallback is easy for the
current helper-level audit to miss, and it reintroduces the exact stable-id class
that Alpha 1 closed for root create helpers.

**Acceptable alternative:** If fork-without-payload is intentionally a
server-generated clone command, update the stable-id contract to name that
exception, add focused tests, and extend the audit so the exception is explicit
rather than invisible. Do not leave an unclassified route-local fallback.

## A2EC2 - Memory Mutations And Active Writer

**Default decision:** browser-triggered memory mutation entrypoints are durable
server-owned mutations and must be active-writer guarded. This includes memory
job create/cancel routes and generation-time prompt assembly paths that can
create memory chunks or enqueue memory jobs.

**Landed 2026-05-28:** Bucket 2 chose the default decision. The active-writer
classifier now guards `POST /api/v1/memory/jobs`,
`DELETE /api/v1/memory/jobs/:id`, `POST /api/v1/generate/chat`, and
`POST /api/v1/generate/preview-prompt`. The memory cancel helper and server-chat
helper send `risu-writer-session` and use shared 423 handling. The current
browser codebase does not have a memory job create helper; create is guarded on
the server route. Memory job list/read routes remain unguarded.

**Why:** Jobs and memory chunks are persisted in SQLite, can cause later memory
writes, and can be created or cancelled from browser-triggered flows. A stale
tab should not enqueue, cancel, or plan durable memory work after another tab has
become the active writer. Read/list routes remain unguarded.

Background worker writes are different: claiming a job, completing a summary, or
writing embeddings is an internal continuation of work already accepted by the
server. Those writes do not carry a browser session header, so they should be
classified as internal rather than forced through the active-writer hook.

**Acceptable alternative:** Document memory jobs as runtime-only exempt state
only if tests prove they cannot affect durable user state and the audit contains
an explicit exemption. Current code does not meet that exemption bar.

## A2EC3 - Audit Shape

**Decision:** prefer discovery plus explicit classifications over narrow
whitelists.

**Landed 2026-05-28:** Bucket 3 kept the command route-local id minting audit
from Bucket 1 and broadened the remaining invariant checks. The audit now
discovers Fastify mutating routes from both direct method calls and
`route({ method, url })` registrations, then compares every `POST`, `PATCH`,
`PUT`, and `DELETE` route against a reviewed classification table. Routes
classified as active-writer guarded must also have independent source proof in
`activeWriter.ts`.

Explicit mutating-route exemptions:

- `POST /api/v1/auth/setup` and `POST /api/v1/auth/login` are auth/session
  metadata routes. They may write password or trusted-key files, but they are
  outside the browser writer-session contract for Risu JSON/SQLite state.
- `POST /api/v1/auth/crypto` is stateless hashing.
- `POST /api/v1/assets/exists` is a read-only asset existence probe that uses
  POST for request-body shape.
- `POST /api/v1/generate/completion` is runtime provider generation and does
  not write local durable state.
- `POST /api/v1/proxy/fetch`, `POST /api/v1/proxy/stream-jobs`,
  `DELETE /api/v1/proxy/stream-jobs/:id`, and mutating
  `/api/v1/hub/*` methods are proxy/runtime surfaces rather than local durable
  Risu state writes.

The asset-walker audit now enumerates every collector field in
`server/fastify/src/risuSave/assetReferences.ts` and requires an owning
validator or indirect-safe owner. The current indirect-safe root profile case is
`database.userIcon`, which is written through the selected persona mirror from a
validated persona `icon`.

**Why:** Phase 9 has repeatedly closed local symptoms while the global invariant
stayed underspecified. The audit should therefore discover public command route
minting, discover Fastify mutating routes, and enumerate walked asset-reference
fields, then compare them against explicit allowed/guarded/validated
classifications.

The audit may still use targeted source checks where TypeScript structure makes
full semantic proof impractical, but every target list should be named as a
classification table with reviewed exclusions.

## A2EC4 - Status Closeout

**Decision:** do not update top-level status docs to "closed" until Buckets 1
through 3 have landed code, tests, and audit coverage.

**Why:** The close/reopen cycle is partly documentation drift. While Alpha 2 is
open, this directory is the live source of truth. Once closed, status docs should
point here the same way they currently point to the first alpha closeout.
