# Slice: MCP Lifecycle And Caps

Phase: [8](../../phase-8-client-interpreters-plugins-media.md). Findings:
L45, L46, L47, and L48. Client MCP lifecycle and boundedness change.

## Scope

Move MCP tool discovery out of the always-server completion route, dedupe
concurrent MCP client construction, cap persistent SSE buffers, and bound
filesystem PDF reads.

This slice owns the browser-side request MCP handoff, MCP initialization,
`MCPClient.connectSSE`, and the filesystem PDF read tool. It does not change
server completion semantics, MCP tool schemas except for limit honoring, or
unrelated internal MCP clients.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L45, L46, L47, and L48.
- `src/ts/process/request/request.ts`: `requestChatData`, `getTools`, and the
  always-server completion route.
- `src/ts/process/request/serverCompletion.ts`: server-backed completion
  adapter boundaries.
- `src/ts/process/mcp/mcp.ts`: `initializeMCPs`, client maps, existing
  `mcpToolClientIndexBuild` in-flight pattern, `getMCPTools`, and
  `callMCPTool`.
- `src/ts/process/mcp/mcplib.ts`: `MCPClient.connectSSE`, persistent
  post-handshake buffer, deadline and debug-log precedents.
- `src/ts/process/mcp/filesystemclient.ts`: `readFileAsPDF` and `limit`
  argument.
- `src/ts/process/dynamicutils/pdf.ts`: `convertPdfToImages` page rendering.
- Existing focused tests:
  `src/ts/process/mcp/mcplib.test.ts`,
  `src/ts/process/mcp/mcp.test.ts`, and
  `src/ts/process/mcp/internalClients.test.ts`.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts` and
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) for
  L45-L48 proof registration.

## Target Shape

- Stop computing MCP tools for the always-server `requestChatData` route when
  those tools are discarded. Compute tools lazily only in browser-local
  adapters that still consume them.
- Preserve tool discovery for local request modes and Playground/MCP surfaces
  that actually call MCP tools.
- Add an in-flight construction promise per MCP key in `initializeMCPs`, using
  the existing `mcpToolClientIndexBuild` pattern as the local precedent.
  Concurrent first-init callers for one key should share one construction and
  one client.
- Clean up failed in-flight entries so later calls can retry.
- Size-cap the persistent `connectSSE` buffer after the handshake. If the
  buffer grows past the cap without a delimiter, abort/destroy the connection
  and surface a clean MCP error instead of growing indefinitely.
- Add page and byte caps to filesystem PDF reads, thread an `AbortSignal` into
  PDF rendering, and honor the `limit` argument. The limit should constrain
  the amount of extracted/rendered content returned to MCP callers.
- Add focused coverage for skipped server-route discovery, concurrent
  first-init dedupe, oversized SSE buffers, PDF page/byte caps, abort, and
  honored `limit`.
- Register L45, L46, L47, and L48 as `DONE` in the v3 gate and flip only
  those rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).

## Invariants

- Browser-local MCP tool calls still initialize, list, and call tools
  successfully.
- Server-backed completion behavior stays unchanged except for removing the
  discarded tool discovery work.
- A failed MCP construction does not poison the client key forever.
- SSE buffer caps fail closed without leaving listeners, timers, or network
  streams alive.
- PDF output remains compatible for files under the caps.

## Done Criteria

- The server completion path no longer calls `getTools()` or
  `initializeMCPs()` only to discard the result.
- Concurrent first initialization of the same MCP key constructs one client
  and shares the result.
- A persistent SSE stream without delimiters is capped and fails cleanly.
- Filesystem PDF reads honor `limit`, enforce page and byte caps, and abort
  promptly when signalled.
- L45-L48 are registered as `DONE` in the v3 gate and active-risk table, with
  no unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/process/mcp/mcplib.test.ts \
  src/ts/process/mcp/mcp.test.ts \
  src/ts/process/mcp/internalClients.test.ts \
  src/ts/process/mcp/filesystemclient.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
