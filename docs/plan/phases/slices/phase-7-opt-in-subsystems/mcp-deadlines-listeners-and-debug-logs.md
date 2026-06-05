# Slice: MCP Deadlines Listeners And Debug Logs

Phase: [7](../../phase-7-opt-in-subsystems.md). Findings: M20, L54, L57.
Runtime change.

## Scope

Add bounded deadlines to remote HTTP MCP request, handshake, and SSE-resolution
paths; guarantee temporary `mcp-sse` listeners are removed on timeout or
completion; and wire the MCP debug flag so payload logs are opt-in.

This slice does not own the Phase 6 `sseIdDone` dedup cap, internal MCP tool
schema caching, or FileSystem directory-handle persistence.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M20, L54, and L57.
- `src/ts/process/mcp/mcplib.ts`: `MCPClient`, constructor `debug` argument,
  `request`, `connectSSE`, SSE wait promises, handshake SSE fallback GET, and
  full-frame logs.
- `src/ts/process/mcp/mcp.ts`: `getMCPTools`, `callMCPTool`, and the
  tools/list response log.
- Existing MCP suite: `src/ts/process/mcp/mcp.test.ts`.
- New focused test home: `src/ts/process/mcp/mcplib.test.ts`.

## Target Shape

- Introduce a default MCP request deadline, overridable through the existing
  request/options surface if one is already present or straightforward to add.
- Wire the request `AbortController` to a timer and pass the deadline through
  `fetchNative`/fetch options so hung HTTP requests abort.
- Factor the SSE response wait into a tracked helper that:
  - adds one document-level `mcp-sse` listener for the expected client/id;
  - removes that listener on match, timeout, abort, or rejection;
  - rejects or resolves to a JSON-RPC error result on deadline rather than
    leaving the promise pending.
- Apply the same deadline behavior to the handshake SSE fallback GET and to
  response waits for both POST-established SSE and `text/event-stream`
  responses.
- Surface timeout failures as RPC-shaped errors to MCP callers. Avoid silent
  hangs and avoid throwing unstructured promises out of tool dispatch.
- Store the constructor `debug` argument on `MCPClient` and gate SSE frame logs,
  request/response payload logs, and tools/list response logs behind it.
- Add listener-count tests for unmatched SSE responses, timeout tests for hung
  fetch and hung SSE waits, handshake timeout coverage, and no-log/debug-log
  assertions.
- Register M20, L54, and L57 as `DONE` in the v2 gate with focused tests, and
  flip all three rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Successful MCP handshake, `tools/list`, `tools/call`, notification, auth
  refresh, and session-id retry behavior remain unchanged.
- Matching SSE responses still win over the timeout and carry the same HTTP
  metadata shape.
- Existing structured fetch logging is not removed by the debug-log gate.
- Timeouts must not leave document listeners, timers, or abort controllers
  live.

## Done Criteria

- Hung MCP HTTP and SSE response paths settle within the configured deadline.
- Temporary `mcp-sse` listeners are removed on success, timeout, and abort.
- MCP full-frame/tools-list logs are silent by default and appear only when
  debug is enabled.
- M20, L54, and L57 v2 gate entries point at real focused tests and the
  risk-map rows are `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/process/mcp/mcplib.test.ts src/ts/process/mcp/mcp.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
