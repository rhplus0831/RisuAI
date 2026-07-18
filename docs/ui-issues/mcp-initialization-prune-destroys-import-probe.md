# Concurrent MCP initialization prune can destroy an import's probe client

## Summary

`initializeMCPs` ends with a prune loop that destroys every registered MCP
client whose URL is not in the *current call's* URL set. Initialization is
guarded only by a depth counter used for idle-waiters, not a mutex, so two
calls interleave across awaits. An MCP module import probes its candidate URL
through `initializeMCPs([url])` before any module references it; a concurrent
module-only initialization (e.g. a chat generation collecting MCP tools) can
prune that freshly handshaken probe client, making the import fail with "MCP
not found" even though the server handshake succeeded.

## Location

- `src/ts/process/mcp/mcp.ts:73-144` — `initializeMCPs`; the prune loop at
  `:126-132` destroys and deletes any `MCPs[key]` not in this call's
  `mcpUrls`.
- `src/ts/process/mcp/mcp.ts:306-320` — `beginMCPInitialization` /
  `finishMCPInitialization` are a depth counter feeding
  `waitForMCPInitializationIdle`; they do not serialize concurrent
  `initializeMCPs` runs.
- `src/ts/process/mcp/mcp.ts:536-543` — `getMCPMeta` reads the registry the
  prune just emptied.
- `src/ts/process/mcp/mcp.ts:595-660` — `importMCPModule` probes via
  `getMCPMeta([url])` before the module exists, so nothing anchors the URL in
  a concurrent call's `mcpUrls`.

## Trigger

Start an MCP module import (paste URL; handshake in flight) while a chat
generation begins in parallel (chat send calls `getMCPTools()` →
`initializeMCPs()` with only module-backed URLs).

## Expected behavior

The import's probe client survives until its metadata is read; module-scoped
initialization does not tear down unrelated in-flight probes.

## Actual behavior

The concurrent module-only run prunes `MCPs[url]` (destroying the freshly
handshaken client) because no module references it yet; `importMCPModule`
then reads `metas[url] === undefined` and shows "MCP not found" — a spurious
import failure.

## Underlying cause

Registry pruning is keyed to each call's own URL set with no notion of
in-flight probe URLs, and initialization calls are not serialized.

## Affected data flow

1. Import → `initializeMCPs([url])` adds the probe client.
2. Concurrent `initializeMCPs()` (module URLs only) → prune loop destroys and
   deletes the probe entry.
3. `getMCPMeta` misses it → `alertError`; the module is never created.

## Severity and likely user impact

**Low.** Timing-dependent (low confidence on how often real users hit the
window), but when hit it turns a valid import into a hard failure with a
misleading error.

## Recommended fix

Track in-flight probe URLs in a module-level set (`additionalMCPs` currently
being imported) and exempt them from the prune loop; alternatively serialize
`initializeMCPs` invocations behind a promise chain.

## Test gap

A test interleaving `initializeMCPs([probeUrl])` with a module-only
`initializeMCPs()` and asserting the probe client survives until
`getMCPMeta` completes.
