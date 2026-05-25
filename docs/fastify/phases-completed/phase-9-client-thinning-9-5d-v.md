# Phase 9 Client Thinning - 9-5d-v

Date: 2026-05-26

## Scope

Process/runtime durable-write classification. This sub-slice audited
generation, scriptstate, memory, and MCP helper writes before the
read-only `DBState.db` guard.

## Landed

- Confirmed terminal server-backed generation persistence already flows
  through `dispatchPersistGenerationResult`, while streaming display
  fields such as `isStreaming` and `reloadKeys` remain transient
  browser-only state for the guard integration slice.
- Routed server-backed sendChat entry-context durable writes through
  existing commands: `lastInteraction` uses the character patch command,
  missing message id backfill uses message replacement, and the local
  usage counter is skipped in Fastify projection mode.
- Confirmed scriptstate mutations in triggers, slash/STScript commands,
  parser chat vars, and server message patch replay already dispatch the
  existing chat scriptstate command after optimistic local updates.
- Gated legacy Hypa V3 `hypaV3Data` writeback so server-backed web mode
  does not persist local memory blobs; Phase 8 server memory remains the
  owner of durable memory rows.
- Routed MCP OAuth refresh token writes through the grouped providers
  settings command after the optimistic local update, with rollback
  restoring the projected `authRefreshes` array if the command fails.

## Verification

```bash
pnpm exec vitest run src/ts/process/__tests__/sendChatContext.test.ts src/ts/process/__tests__/buildMemoryWindow.test.ts src/ts/process/mcp/mcp.test.ts
pnpm exec vitest run src/ts/compatibilityAdapters.test.ts src/ts/server/commands.test.ts
pnpm check
```

Results:

- `src/ts/process/__tests__/sendChatContext.test.ts`,
  `src/ts/process/__tests__/buildMemoryWindow.test.ts`, and
  `src/ts/process/mcp/mcp.test.ts` - 30 tests passed.
- `src/ts/compatibilityAdapters.test.ts` and
  `src/ts/server/commands.test.ts` - 44 tests passed.
- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.

## Handoff

Continue with **9-5e-i - Projection write gate foundation**. Add the
server-backed read-only guard primitive and trusted projection
replacement helpers for bootstrap/event refresh writes. Do not broaden
9-5e-i into residual write fixes; guard failures that expose missed
durable writes should be split into follow-up residual slices.
