# Phase 6: Lifecycle, Rebuild, and Interchange

Status: pending.

Goal: complete transcript/chat lifecycle handling, historical rebuild, Markdown
vault interchange, backup/restore recovery, and large-corpus operational tools.

## Depends On

- Phase 5 automatic and canonical update semantics are stable.

## Scope

- Implement explicit historical rebuild with preview/confirmation, progress,
  cancellation, restart recovery, and bounded batching.
- Define rebuild replacement versus merge behavior exactly; default to a fresh
  derived corpus while preserving explicitly manual documents according to the
  Phase 0 policy.
- Complete source edit/delete/truncate/alternate handling for both incremental
  updates and rebuild eligibility.
- Complete chat delete and character delete cascade proof.
- Implement fork behavior:
  - Initial safe path rebuilds from the retained fork transcript.
  - Any later copy optimization must remap source ids/hashes and prove prefix
    validity rather than cloning current canon blindly.
- Add Obsidian-compatible Markdown vault export with deterministic paths,
  frontmatter, wikilinks, manifest, provenance policy, and path collision rules.
- Add bounded import with dry-run/diff, validation, conflict strategy, and one
  revisioned commit or explicit batching contract.
- Rebuild derived search/link state after restore/import and verify no stale
  rows survive.
- Add operational controls for failed/stale receipts, bulk retry, reconcile,
  rebuild, and review queues.
- Add corpus/job retention and pruning policy that never prunes source/version
  records still required for user-visible history or safe reconciliation.
- Verify exact database backup restore and import-like merge remain distinct.

## Out of Scope

- Live filesystem synchronization.
- Cross-chat shared wiki or cloud collaboration.
- Unbounded automatic rebuild on server startup.

## Anchors

- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/messageStore.ts`
- `server/fastify/src/routes/backups.ts`
- Save/import/export and chat-fork modules identified at phase start.
- BardWiki repositories, jobs, workspace, and source-invalidation modules.

## Lifecycle Matrix

| Action | Required BardWiki behavior |
| --- | --- |
| Edit source message | Pending job obsolete; applied receipt stale and reconciled/reviewed. |
| Delete/truncate source | Same as edit, with no orphan provenance or links. |
| Switch reroll candidate | Unconfirmed candidate only; an explicitly applied receipt becomes stale. |
| Delete chat/character | Cascade all documents, versions, receipts, links, search, and jobs. |
| Fork full chat | Rebuild from fork transcript; optimize only with proven source remap. |
| Fork historical prefix | Rebuild only from retained prefix; never clone future canon. |
| Exact backup restore | Reproduce BardWiki authoritative state exactly. |
| Import/merge | Validate and resolve ids/paths/conflicts as new revisioned content. |
| Rebuild | Explicit, resumable, cancellable, deterministic in source ordering. |

## Invariants

- Rebuild is never triggered merely by opening a chat or enabling the feature.
- A historical fork cannot inherit facts sourced only from messages after its
  fork point.
- Exact restore preserves receipt/job/document identity according to backup
  policy; import does not pretend to be exact restore.
- Export paths cannot escape the archive root or collide after normalization.
- Import cannot write path traversal, oversized, malformed, cross-chat, or
  foreign-source records.
- Cancellation and restart leave a rebuild resumable or safely restartable,
  never half-presented as complete.
- Manual documents and edits follow the locked rebuild preservation policy.
- Derived indexes are reproducible from authoritative document rows.

## Required Coverage

- The full lifecycle matrix.
- Rebuild batching, ordering, retry, cancellation, restart, partial provider
  failure, and final atomic/published state.
- Manual-document preservation and canonical replacement/merge policy.
- Fork full transcript and historical prefix with new message ids.
- Export/import round trip for Unicode, aliases, links, duplicate titles,
  normalized path collisions, and frontmatter.
- Zip/path traversal, size/count limits, malformed Markdown/frontmatter, and
  partial-import rollback.
- Exact backup/restore and derived-index rebuild.
- Large corpus and long backlog remain bounded and responsive.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/backups.test.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/memoryWorker.test.ts
pnpm exec vitest run \
  src/ts/chatFork.test.ts \
  src/ts/chatCommands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Add focused rebuild and vault-codec/import/export suites. Run the browser smoke
path when lifecycle controls are visible and the affected-test selector calls
for it.

## Exit Criteria

- Every transcript/chat mutation has deterministic BardWiki behavior.
- Historical rebuild is explicit, restart-safe, observable, and bounded.
- Forks cannot leak future source facts.
- Markdown export/import and exact backup/restore are separately correct.
- Derived indexes and operational status recover cleanly after restart/restore.

## Risks

- Rebuild can be expensive and provider-costly; require explicit confirmation,
  previewed scope, batching, and cancellation.
- Copying canonical documents on fork without source remapping creates subtle
  future-fact leakage.
- Vault import is an attack surface for paths, archive expansion, and oversized
  content; validate before mutation and cap every dimension.
