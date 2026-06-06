# Slice: MCP Internal Tool Index And Filesystem Handle

Phase: [7](../../phase-7-opt-in-subsystems.md). Findings: L55, L56. Runtime
change. Status: done on 2026-06-06.

## Scope

Avoid repeated internal MCP tool-schema construction and repeated per-tool
full MCP listing, and keep the internal FileSystem MCP directory handle across
module-set client recreation.

This slice does not own remote MCP request deadlines, SSE listener cleanup, or
debug logging.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L55 and L56.
- `src/ts/process/mcp/filesystemclient.ts`: `FileSystemClient`,
  `directoryHandle`, `initializeDirectory`, `getToolList`.
- `src/ts/process/mcp/googlesearchclient.ts`: `GoogleSearchClient.getToolList`.
- `src/ts/process/mcp/mcp.ts`: `initializeMCPs`, `MCPs`, `callOnlyMCPs`,
  `getMCPTools`, `callMCPTool`.
- Existing MCP suites:
  `src/ts/process/mcp/mcp.test.ts`,
  `src/ts/process/mcp/googlesearchclient.test.ts`.
- New focused test home: `src/ts/process/mcp/internalClients.test.ts`.

## Target Shape

- Move static internal tool schemas out of per-call construction. Return fresh
  shallow/deep copies only where needed to protect callers from mutating shared
  literals.
- Add a name-to-client index for initialized MCPs so `callMCPTool` does not
  call every client's `getToolList()` on every dispatch.
- Invalidate/rebuild the index only when MCP initialization inputs change, such
  as additional MCP URLs, module toggles, or internal client registration.
- Preserve duplicate-tool-name behavior unless intentionally changed elsewhere:
  the first matching client in the existing enumeration order still wins.
- Persist the FileSystem directory handle outside the short-lived
  `FileSystemClient` instance, or otherwise transfer it during client
  recreation, so toggling module sets does not force a fresh
  `showDirectoryPicker()` prompt.
- Keep FileSystem permission and cancellation errors explicit. If the stored
  handle becomes invalid, recover by prompting again only then.
- Add tests that count internal `getToolList` construction/list calls,
  demonstrate indexed dispatch, preserve duplicate-name winner order, and prove
  FileSystem client recreation reuses an existing handle without calling the
  picker again.
- Register L55 and L56 as `DONE` in the v2 gate with focused tests, and flip
  both rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- `getMCPTools` still returns tools with the same `mcpURL` annotations and
  server metadata behavior.
- `callMCPTool` still returns the same not-found text when no tool exists.
- Internal FileSystem read/write/list behavior and path semantics are
  unchanged.
- GoogleSearch credential handling is not revived or expanded in this runtime.

## Done Criteria

- [x] Internal MCP tool schemas are not rebuilt on every tool-list or dispatch
  call.
- [x] `callMCPTool` dispatches through a cached name-to-client index and avoids
  re-listing every MCP per call.
- [x] Recreating internal MCP clients after a module toggle does not re-open the
  FileSystem directory picker when a valid handle already exists.
- [x] L55 and L56 v2 gate entries point at real focused tests and the risk-map rows
  are `DONE`.

## Completed Proof

- `src/ts/process/mcp/internalClients.test.ts`: `L55: FileSystem and Google
  Search return mutation-safe copies of static tool schemas`; `L56: reuses a
  valid directory handle across FileSystem client recreation`; `L56: prompts
  again only after the stored directory handle becomes invalid`.
- `src/ts/process/mcp/mcp.test.ts`: `L55: dispatch builds the tool-name index
  once and reuses it for later calls`; `L55: rebuilds the dispatch index when
  MCP initialization inputs change`.
- `src/ts/__tests__/fixCompletenessGateV2.test.ts` registers L55/L56 as `DONE`;
  `docs/plan/active-risk-analysis.md` marks both rows `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/process/mcp/internalClients.test.ts src/ts/process/mcp/mcp.test.ts src/ts/process/mcp/googlesearchclient.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
