# Slice: MCP Lifecycle And Caps

Phase: [8](../../phase-8-client-interpreters-plugins-media.md). Findings:
L45, L46, L47, and L48. v4 amendment: v4-L35 where it matches the
filesystem MCP cap invariant. Client MCP lifecycle and boundedness change.

## Scope

Move MCP tool discovery out of the always-server completion route, dedupe
concurrent MCP client construction, cap persistent SSE buffers, and bound
filesystem PDF/base64/search reads.

This slice owns the browser-side request MCP handoff, MCP initialization,
`MCPClient.connectSSE`, and the filesystem PDF read tool. It does not change
server completion semantics, MCP tool schemas except for limit honoring, or
unrelated internal MCP clients.

The v4 routing is intentionally narrow: v4-L35 rides because it is the same
filesystem MCP cap family as L48. v4-L38 does not ride this slice because
DPoP keypair persistence and auth recovery are outside MCP/media/plugin
lifecycle and do not match this slice's abort/cap/log cleanup invariant.

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
  argument; v4-L35 base64 read and content-search cap siblings.
- `src/ts/process/dynamicutils/pdf.ts`: `convertPdfToImages` page rendering.
- [`../../../../v4/audit-stability-and-performance-v4.md`](../../../../v4/audit-stability-and-performance-v4.md):
  v4-L35.
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
- Extend the same cap policy to the filesystem MCP base64 and content-search
  siblings: base64 encoding must not spread a whole `Uint8Array` into
  `String.fromCharCode`, and content search must enforce a per-file size cap
  before reading or scanning a file.
- Inventory every MCP cache, listener, timer, stream buffer, PDF document,
  and filesystem read path touched by this slice. Each live site must be
  fixed, explicitly no-actioned with reason, or measured/deferred with an
  owner note in the slice proof.
- Add focused coverage for skipped server-route discovery, concurrent
  first-init dedupe, oversized SSE buffers, PDF page/byte caps, base64 reads
  above the historical spread limit, content-search per-file caps, abort, and
  honored `limit`.
- Register L45, L46, L47, and L48 as `DONE` in the v3 gate and flip only
  those rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).
  Record v4-L35 coverage in proof text without adding unrelated v3 status
  changes.

## Invariants

- Browser-local MCP tool calls still initialize, list, and call tools
  successfully.
- Server-backed completion behavior stays unchanged except for removing the
  discarded tool discovery work.
- A failed MCP construction does not poison the client key forever.
- SSE buffer caps fail closed without leaving listeners, timers, or network
  streams alive.
- PDF output remains compatible for files under the caps.
- Binary-to-base64 conversion must be chunked or streaming-safe for inputs
  under the configured cap.
- Filesystem search must not read unbounded file contents from an opt-in MCP
  module.

## Done Criteria

- The server completion path no longer calls `getTools()` or
  `initializeMCPs()` only to discard the result.
- Concurrent first initialization of the same MCP key constructs one client
  and shares the result.
- A persistent SSE stream without delimiters is capped and fails cleanly.
- Filesystem PDF reads honor `limit`, enforce page and byte caps, and abort
  promptly when signalled.
- Filesystem base64 reads handle files above the old spread failure threshold
  up to the cap, and content search rejects or skips files above the per-file
  cap with a clear result.
- The slice proof records the MCP cache/listener/timer/buffer/PDF/read-path
  inventory, including any explicit no-action or measured-deferred entries.
- L45-L48 are registered as `DONE` in the v3 gate and active-risk table, with
  no unrelated ID status changes.

## Proof Notes

- Fixed L45 request discovery: `requestChatDataMain()` resolves the Fastify
  server route before MCP discovery, so server-backed completions return
  through `requestServerCompletion()` without calling `getTools()` or
  `initializeMCPs()`. Browser-local dispatch still fills `tools` lazily before
  provider adapters that can consume MCP calls.
- Fixed L46 MCP construction cache: `initializeMCPs()` now uses
  `mcpClientInitializationBuilds`, an in-flight promise map keyed by MCP URL or
  internal/plugin key. Concurrent first callers share construction, successful
  clients still land in `MCPs`/`callOnlyMCPs`, tool-index invalidation remains
  tied to client visibility, and failed builds clear their in-flight entry so a
  later call retries instead of poisoning the key.
- Fixed L47 stream/listener/timer inventory: `connectSSE()` now byte-counts the
  unterminated persistent buffer and, past the cap, dispatches a client-scoped
  JSON-RPC error, aborts the transport, cancels the reader, calls `destroy()`,
  and removes the SSE record. The existing `waitForSseResponse()` listener and
  timeout cleanup handles the dispatched stream error; the existing duplicate
  ID cache remains window-bounded by `WindowedSseIdDedup`.
- Fixed L48 PDF document and filesystem read inventory: PDF reads reject files
  above the input cap before `arrayBuffer()`, thread `AbortSignal` into
  pdf.js rendering, cap rendered pages and output bytes, and destroy pdf.js
  loading/document state in cleanup. Text reads remain under the existing
  100 KB limit and now honor smaller caller limits. Base64 reads honor the
  image cap and encode in bounded chunks, covering the v4-L35 spread failure.
  Content search checks each file size before `text()` and reports skipped
  oversized files, covering the v4-L35 search rider. `extractPdfText()` is
  no-action for this slice because the filesystem MCP read path renders PDF
  pages through `convertPdfToImages()`.

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
