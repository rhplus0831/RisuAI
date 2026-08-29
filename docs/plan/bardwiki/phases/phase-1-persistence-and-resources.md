# Phase 1: Persistence and Server Resources

Status: complete.

Goal: establish authoritative BardWiki storage, narrow repositories, targeted
reads, revisioned settings/document commands, and complete backup ownership
without prompt retrieval or model-authored updates.

## Progress

Slice 1 added schema migration v33 and the locked BardWiki authoritative,
operational, staging, and derived tables. `bardWikiRepository.ts` owns path,
title, alias, Markdown, link, and settings validation; current-document and
immutable-version reads; optimistic version/hash fences; soft deletion; and
transaction-compatible document/version/link/search writes. Focused repository
and migration tests cover normalization, unsafe paths, settings inheritance
representation, versions, link resolution, stale writers, path isolation and
reuse, caller rollback, and chat cascades.

Validation on 2026-08-29:

```text
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/bardWikiRepository.test.ts \
  server/fastify/__tests__/db.test.ts
# 2 files, 33 tests passed
```

At the Slice 1 boundary, production routes remained deliberately unregistered.

Slice 2 added active-writer BardWiki chat-settings and manual document
create/update/delete commands through the targeted SQLite mutation path. Each
command validates a narrow body, participates in durable mutation-receipt
replay, writes its document version/projections inside the command transaction,
bumps the global revision once, and persists one narrow BardWiki event. Focused
route tests cover auth, the complete manual command sequence, revision and
document conflicts, invalid-path rollback, and mutation-id replay.

Additional validation on 2026-08-29:

```text
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/bardWikiRepository.test.ts \
  server/fastify/__tests__/bardWikiRoutes.test.ts \
  server/fastify/__tests__/db.test.ts
# 3 files, 37 tests passed
```

Slice 3 added the shared TypeBox wire contract, authenticated body-free chat
indexes, lazy document bodies, paginated immutable versions, receipt summaries,
ETags, browser decoders and resident resource caches. Narrow BardWiki events now
refresh only loaded chat/document/version projections, while full revision-gap
recovery refreshes every loaded BardWiki projection. The protocol and server
route manifests classify the new surfaces and protection requirements.

Additional validation on 2026-08-29:

```text
pnpm exec vitest run \
  packages/protocol/src/bardWiki.test.ts \
  src/ts/server/resourceInvalidation.test.ts
# 2 files, 103 tests passed

pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/bardWikiRepository.test.ts \
  server/fastify/__tests__/bardWikiRoutes.test.ts \
  server/fastify/__tests__/routeProtection.test.ts
# 3 files, 35 tests passed

pnpm check:server
# protocol, client-library, browser-smoke, and Fastify typechecks passed
```

Slice 4 classified all nine authoritative/operational BardWiki tables as
restore-owned and the lexical search table as explicitly derived. Restore now
rebuilds search terms and link resolution from authoritative documents before
commit. Coverage poisons the snapshot projections, deletes the live chat, then
proves the restored settings, documents, versions, receipts, jobs, sources,
links, manifests, staging rows, and rebuilt projections.

Final Phase 1 validation on 2026-08-29:

```text
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/bardWikiRepository.test.ts \
  server/fastify/__tests__/backups.test.ts
# 2 files, 63 tests passed

pnpm check:server
# protocol, client-library, browser-smoke, and Fastify typechecks passed
```

All exit criteria are satisfied. Phase 2 owns global settings UI and the
chat-scoped manual workspace; no prompt or autonomous behavior changed here.

## Depends On

- Phase 0 exact contracts and matrices are complete.

## Scope

- Add the schema migration and creation/repair paths for the locked BardWiki
  tables, indexes, foreign keys, and derived search representation.
- Add focused repository modules for chat settings, documents, versions,
  receipts, sources, links, and derived search maintenance.
- Add authenticated targeted reads for chat BardWiki summary/settings, document
  index, individual document/version content, and receipt state.
- Add active-writer, revision-checked commands for:
  - Per-chat BardWiki settings.
  - Manual document create/update/delete/rename.
  - Context policy, aliases, and review state.
- Require expected document version/hash for edits and deletes.
- Commit document body, version snapshot, source/link/search changes, one
  revision, and one command event atomically.
- Add resource-manifest and event-invalidation ownership for the new reads.
- Add all durable tables to backup/restore ownership and explicitly classify
  derived/excluded tables.
- Ensure chat deletion cascades all BardWiki data without manual orphan cleanup.
- Bound and validate Markdown, title, alias, logical path, and batch sizes.

## Out of Scope

- Settings or chat workspace UI.
- Prompt injection.
- Background jobs, model calls, or automatic confirmation.
- Import/export and fork-copy behavior beyond schema-safe delete lifecycle.

## Anchors

- `server/fastify/src/db.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/commands/events.ts`
- `server/fastify/src/routeManifest.ts`
- `src/ts/server/resourceManifest.ts`
- `src/ts/server/resourceInvalidation.ts`
- `server/fastify/__tests__/backups.test.ts`
- `server/fastify/__tests__/routeProtection.test.ts`

## Implementation Slices

1. Schema migration, constraints, row types, and low-level repository tests.
2. Manual document/settings command handlers with narrow targeted mutation
   reads/writes and optimistic hash/version checks.
3. Targeted resource reads, protocol/client decoders, manifest declarations,
   event invalidation, and cache application.
4. Backup/restore classification, cascade behavior, and repair/rebuild-index
   coverage.

Keep the schema/repository slice independently testable before registering
routes. Do not let a route deserialize arbitrary Markdown metadata directly into
SQL writes; every field passes through one validator.

## Invariants

- SQLite is the only authority.
- Stable document id is distinct from logical path.
- Unique path comparisons use the exact Phase 0 normalization policy.
- A failed document mutation leaves no version, link, search, event, or revision
  residue.
- A successful mutation bumps the revision exactly once.
- Read routes never hydrate unrelated chats or the whole document corpus.
- Command replay is idempotent through the normal mutation receipt contract.
- Search/link projections never outlive a deleted document.
- Chat deletion leaves no BardWiki rows.
- Backup restore reproduces documents, versions, sources, receipts, settings,
  and any non-derived link state exactly.

## Required Coverage

- Schema creation and migration from the preceding schema version.
- Foreign-key cascades and unique normalized paths per chat.
- Create/update/delete/rename with expected hash/version.
- Revision conflict, active-writer rejection, duplicate mutation replay, auth,
  payload size, and invalid path/Markdown/alias input.
- Multi-document isolation across chats.
- Version/source/link/search atomicity and rollback.
- ETag/targeted resource reads and event-driven invalidation.
- Backup table parity and restore round trip.

## Validation

Use focused new BardWiki test files plus the affected existing suites. Expected
baseline command shape:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/backups.test.ts \
  server/fastify/__tests__/routeProtection.test.ts
pnpm exec vitest run \
  src/ts/server/resourceManifest.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Replace or add focused file names after Phase 0 locks the test layout; record
the exact passing commands in [`../status.md`](../status.md).

## Exit Criteria

- Manual server CRUD and targeted reads are authoritative and idempotent.
- Schema and backups have exhaustive ownership proof.
- Browser resource code can load/reconcile a chat's BardWiki state without UI.
- No autonomous processing or prompt behavior has changed.
- All required coverage passes and Phase 2 has no unresolved persistence API.

## Risks

- FTS virtual tables can create hidden shadow tables that violate backup parity.
  Classify them explicitly or treat them as derived and rebuild them reliably.
- Broad chat hydration would regress the server's targeted-read architecture.
- Path-based ids make rename, aliases, provenance, and imports brittle; retain
  stable ids and path uniqueness separately.
