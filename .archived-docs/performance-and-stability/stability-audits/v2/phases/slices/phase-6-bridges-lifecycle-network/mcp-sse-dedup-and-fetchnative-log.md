# Slice: MCP SSE Dedup And FetchNative Log

Phase: [6](../../phase-6-bridges-lifecycle-network.md). Findings: L46, L47.
Runtime change.

## Scope

Bound the legacy MCP SSE duplicate-id set and remove the unconditional
`fetchNative` request-body console log.

This slice does not own MCP request deadlines, SSE wait listener cleanup, MCP
debug-log gating, or fetch-log storage/export behavior. Those are routed to
other findings.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L46 and L47.
- `src/ts/process/mcp/mcplib.ts`: `MCPClient.sseIdDone`,
  `connectSSE`, ping handling, duplicate suppression.
- `src/ts/globalApi.svelte.ts`: `fetchNative`, `console.log(arg.body, 'body')`,
  `addFetchLog`.
- Existing MCP suite: `src/ts/process/mcp/mcp.test.ts`.
- Existing global API suites:
  `src/ts/globalApi.proxy.test.ts`,
  `src/ts/globalApi.getFileSrc.test.ts`,
  `src/ts/globalApi.changeChatTo.test.ts`.
- New focused test homes:
  `src/ts/process/mcp/mcplib.test.ts`,
  `src/ts/globalApi.fetchNative.test.ts`.

## Target Shape

- Replace `sseIdDone: Set<string | number>` with a bounded windowed-dedup
  helper. A simple `Set` plus FIFO array is acceptable if insert, duplicate
  check, and eviction stay consistent.
- Use a cap large enough for normal in-flight SSE activity, such as 512-2048
  ids per client. Keep the cap local to each `MCPClient` instance.
- Apply the dedup helper to both ping ids and JSON-RPC response ids. Duplicate
  ids inside the retained window should still be ignored exactly as today.
- When the cap is exceeded, evict oldest ids deterministically. Very old ids may
  be processed again after eviction; that is the intended bounded-memory trade.
- Remove the unconditional `console.log(arg.body, 'body')` from `fetchNative`.
  Do not remove the structured `addFetchLog` path in this slice unless the gate
  explicitly changes, because that log is part of existing app diagnostics.
- Add tests proving `sseIdDone` stays at or below the cap, duplicates inside the
  window are suppressed, and `fetchNative` does not call `console.log` with the
  request body.
- Register L46 and L47 as `DONE` in the v2 gate with focused tests, and flip
  their rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- MCP ping response behavior is unchanged for retained ids.
- JSON-RPC response dispatch still fires the `mcp-sse` custom event for new
  ids.
- Stream parsing, endpoint-event handling, and abort-controller tracking remain
  unchanged.
- `fetchNative` still enforces body requirements for POST/PUT, applies body
  interceptors, honors local-network routing, writes the existing fetch log, and
  returns the same `Response` shape.

## Done Criteria

- A long legacy MCP SSE session cannot grow the per-client dedup set beyond the
  configured cap.
- Duplicate ping/response ids within the retained window are still ignored.
- `fetchNative` no longer logs request bodies to the developer console.
- L46 and L47 v2 gate entries point at real focused tests and the risk-map rows
  are `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/process/mcp/mcp.test.ts src/ts/process/mcp/mcplib.test.ts src/ts/globalApi.fetchNative.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
