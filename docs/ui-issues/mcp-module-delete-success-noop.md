# MCP module delete returns success without deleting the record

## Summary

Deleting an MCP module removes it optimistically from the client, but the Fastify delete route treats every MCP row as absent and returns a successful `module.deleted` event without changing storage. Authoritative reconciliation then restores the undeleted record and its references.

## Location

- `src/lib/Setting/Pages/Module/ModuleSettings.svelte:254-267`
- `src/ts/moduleCommands.ts:623-660,907-918,941-967`
- `src/ts/server/commands.ts:4601-4611,5386-5406`
- `server/fastify/src/routes/commands.ts:7204-7242`
- `server/fastify/src/commands/events.ts:600-605`
- `src/ts/server/resourceInvalidation.ts:695-700`
- `src/ts/server/resourceState.svelte.ts:1336-1365`

## Trigger

Click Delete on an MCP row in Module Settings and confirm the dialog.

## Expected behavior

The MCP record and any enabled, character, chat, or loadout references should be removed durably, or the server should explicitly reject deletion and leave the UI unchanged.

## Actual behavior

The row disappears immediately. The server returns success but leaves the database unchanged. Response-driven resource reconciliation reloads the unchanged module collection and references, so the row reappears; until that refresh completes, different projections can disagree about whether the module exists.

## Underlying cause

The delete route searches with `module.id === moduleId && !module.mcp`. When an MCP row exists, the resulting index is `-1`, and the route takes the same idempotent-success branch used for a genuinely missing record. It emits `module.deleted` even though it did not splice the module or remove references.

## Affected data flow

1. **UI:** `ModuleSettings.svelte:254-267` exposes the generic Delete action for MCP rows.
2. **Client state:** `moduleCommands.ts:907-918,941-967` removes the module, its enabled ID, and projected character/chat/loadout references optimistically.
3. **Client request:** `moduleCommands.ts:623-660` and `server/commands.ts:4601-4611` send `DELETE /api/v1/commands/modules/:moduleId`.
4. **Server persistence:** `routes/commands.ts:7217-7224` excludes MCP records, performs no write, but returns a successful deletion event.
5. **Response:** `server/commands.ts:5386-5406` accepts the receipt. `moduleCommands.ts:648-650` clears the optimistic operation as successful.
6. **Display synchronization:** the broad deletion resource (`commands/events.ts:600-605`) reloads module settings, modules, loadouts, and characters (`resourceInvalidation.ts:695-700`); `resourceState.svelte.ts:1336-1365` applies the still-present authoritative row.

## Severity and user impact

**High.** MCP records cannot be removed through the visible control, and the false-success acknowledgement produces a direct disappear-then-reappear regression. References may also appear removed temporarily even though they remain persisted.

## Recommended fix

Either delete MCP rows and their references in the server route or return an explicit unsupported-operation error for an existing MCP row. Distinguish “missing” from “present but MCP,” and do not emit a deletion event or advance deletion state for a no-op. Hide/disable the UI action if deletion is intentionally unsupported, and report command failures.

## Test coverage gap

Add server and UI integration coverage for deleting an existing MCP module. The test must verify the persisted collection and references, the command status/event, the optimistic projection after reconciliation, and state after reload. Include a separate idempotent-delete test for a truly missing ID.
