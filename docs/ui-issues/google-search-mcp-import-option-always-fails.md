# Google Search MCP import option always fails

## Summary

The MCP import dialog advertises the built-in Google Search client as a selectable option, but that client has no usable credential path in the Fastify variant. Its handshake always throws, the MCP registry removes it, and the import flow reports that the advertised server was not found. No module command reaches Fastify and nothing is persisted.

The pre-migration client prompted for the API key and search-engine ID and stored them in its browser credential store. That behavior was replaced with an unconditional unsupported error, while the option that depends on it remained in the live UI.

## Location

- `src/lib/Setting/Pages/Module/ModuleSettings.svelte:294-308`
- `src/ts/process/mcp/mcp.ts:73-144,164-207,289-303,536-542,595-660`
- `src/ts/process/mcp/googlesearchclient.ts:128-158`
- `src/ts/process/mcp/googlesearchclient.test.ts:41-52`

## Trigger

1. Open Settings → Modules.
2. Choose the MCP import action.
3. Select **Google Search Client (`internal:googlesearch`)** from the provided datalist and submit.

## Expected behavior

Every built-in choice offered by the import UI should have a complete setup path. Selecting Google Search should collect or reference server-managed credentials, complete the handshake, create the MCP-backed module through Fastify, and leave the module visible after reload. If credentials cannot be supported safely, the option should not be offered.

## Actual behavior

The import button enters its busy state, but the Google Search handshake always fails. The temporary client is removed from the MCP registry, `getMCPMeta()` returns no metadata for the selected identifier, and the UI shows the generic “MCP not found” error. No module row is created locally or on the server. Repeating the operation always produces the same result.

## Underlying cause

`importMCPModule()` includes `internal:googlesearch` in its hard-coded user-facing choices. Constructing that identifier creates `GoogleSearchClient`, whose `checkHandshake()` calls `initializeCredentials()`.

In the Fastify variant, `initializeCredentials()` contains only:

```ts
throw new Error('Google Search MCP credentials are not supported in server-backed web mode')
```

`checkHandshakeOrRemoveClient()` catches that error, logs it only to the console, destroys the client, removes it from `MCPs`, and returns `false`. The caller does not propagate the reason. `getMCPMeta()` therefore completes successfully with no entry, so `importMCPModule()` takes its `mcpNotFound` branch instead of explaining that this particular built-in is unsupported.

The migration correctly avoids reading or writing a browser-only credential store—the dedicated unit test enforces that—but it did not replace that store with a Fastify-owned secret flow or remove the now-invalid UI option.

## Affected data flow

1. **UI interaction:** `ModuleSettings.svelte:294-308` calls and awaits `importMCPModule()` while `mcpImportPending` disables the import button.
2. **Client selection:** `mcp.ts:595-608` supplies `internal:googlesearch` as one of the normal datalist values returned by the shared input alert.
3. **Handshake:** `getMCPMeta([identifier])` runs MCP initialization. `constructMCPClientForKey()` creates `GoogleSearchClient`, and `checkHandshake()` invokes its unconditional unsupported credential method.
4. **Client registry:** `checkHandshakeOrRemoveClient()` catches the failure and removes the client. The metadata projection consequently contains no row for the selected identifier.
5. **Request and persistence:** `importMCPModule()` exits at the missing-metadata check before it constructs a `RisuModule` or calls `createGlobalModule()`. No `POST /api/v1/commands/modules` request is sent, no SQLite row is written, and no command acknowledgement or SSE event exists.
6. **Displayed state:** the busy flag clears in `finally`; the module list remains unchanged and the shared alert shows the generic not-found failure.

## Severity and user impact

**Medium.** One prominently advertised built-in MCP integration is impossible to import for every Fastify user. The failure is deterministic but presented as a discovery/network problem, encouraging retries and credential troubleshooting that cannot succeed. It also creates a misleading inconsistency with the other built-in choices in the same list.

## Recommended fix

Either implement a Fastify-owned Google Search credential path or remove/disable the choice until one exists.

For a supported implementation, define server-managed secret fields for the API key and search-engine ID, expose an authenticated setup/status command that never echoes raw secrets, and have the internal MCP client execute Google requests through a server operation that resolves those stored credentials. The import handshake should return a structured `credentials-required` state so the UI can open that setup flow.

If support is intentionally deferred, filter `internal:googlesearch` out of the import choices and show an explicit localized unsupported explanation for previously persisted rows. In both cases, propagate handshake failure reasons instead of collapsing them to `mcpNotFound`.

Add a component/integration test that chooses every advertised built-in identifier and asserts that it either reaches module persistence or is visibly disabled with a specific reason. The current Google Search test proves only that browser credential storage is not used; it also codifies the unsupported handshake without checking that the live import UI still advertises it.
