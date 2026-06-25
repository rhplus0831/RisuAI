# Plugins And MCP

Plugins and MCP tooling are browser runtime features with server-backed records.
Fastify stores plugin records, plugin storage, settings, and module state, but it
does not execute browser plugin code.

## Plugin Runtime

| Path                                                         | Purpose                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `src/ts/plugins/plugins.svelte.ts`                           | Plugin import/update/load, V2 compatibility, custom providers, command-backed state dispatch. |
| `src/ts/plugins/apiV3/v3.svelte.ts`                          | Plugin API V3 surface exposed to sandboxed plugins.                                           |
| `src/ts/plugins/apiV3/factory.ts`                            | `SandboxHost` iframe/RPC bridge between app and plugin guest code.                            |
| `src/ts/plugins/apiV3/transpiler.ts`, `developMode.ts`       | Plugin V3 transpilation and development-mode loading.                                         |
| `src/ts/plugins/apiV3/risuai.d.ts`                           | Plugin V3 TypeScript declarations for plugin authors.                                         |
| `src/ts/plugins/pluginSafeClass.ts`, `pluginSafety.ts`       | Safe wrappers, static safety rewrite/checks, device-local storage gates.                      |
| `src/ts/plugins/unsupportedServerWriteGuard.ts`              | Blocks Plugin API direct writes to fields unsupported in server-backed mode.                  |
| `src/ts/pluginCommands.ts`                                   | Browser command wrappers for plugin records, provider selection, plugin storage, and settings-adjacent compatibility writes. |
| `src/ts/server/pluginImport.ts`                              | Server-backed plugin import/update helper with stale import guards.                           |
| `server/fastify/src/commands/plugins.ts`, `pluginStorage.ts` | Server validation for plugin records and plugin key/value JSON storage.                       |

Plugin records live in `Database.plugins` and use the plugin `name` as the
stable id. `currentPluginProvider` selects a plugin-defined provider when one is
active. Plugin providers remain browser compatibility surfaces; Fastify
chat/completion does not execute plugin provider code.

Plugin V3 code runs through an iframe RPC boundary. API functions must accept
and return serializable data, callback functions, marked remote class instances,
or abort signals. API `2.1` compatibility records can still load with warnings;
API `2.0` import is blocked and older existing records only warn as removed/not
supported. Plugin V2 edit/replacer hooks make server prompt assembly return
`unsupported`; Fastify never executes browser plugin code. Server Lua scripting
is separate from browser plugins.

## Plugin Storage

- Server-backed plugin custom storage is `Database.pluginCustomStorage`, mutated
  through `PUT /api/v1/commands/plugin-storage/:key`,
  `DELETE /api/v1/commands/plugin-storage/:key`, or
  `POST /api/v1/commands/plugin-storage/bulk`.
- Device-local plugin storage wraps `localStorage`, IndexedDB, and localforage
  through safe prefixes. In Fastify mode it is disabled unless
  `pluginCompatibilityMode` is enabled, and remains plugin sandbox
  compatibility/cache storage rather than app database or backup persistence.

Plugin storage persists in the SQLite `plugin_custom_storage` table. Plugin
records can narrow targeted projection through the `plugin` resource, but
`pluginStorage` is a known full-bootstrap projection resource. Heavy
plugin/module bodies may be stubbed in bootstrap and filled from the
bootstrap-body-cache path.

Plugin API calls that patch settings, modules, characters, chats, lorebooks, or
scripts should use command-backed helpers. Unsupported direct resource keys stay
blocked in server-backed mode so plugin code cannot silently mutate projection
state.

## Fastify Command Routes

Plugin command routes are part of the generic `/api/v1/commands/` manifest entry
and use the same auth, active-writer, base-revision, and command-event contract
as other command routes:

- `POST /api/v1/commands/plugins`
- `PATCH /api/v1/commands/plugins/:pluginId`
- `DELETE /api/v1/commands/plugins/:pluginId`
- `POST /api/v1/commands/plugins/:pluginId/enable`
- `POST /api/v1/commands/plugins/provider`
- `POST /api/v1/commands/plugins/reorder`
- `PUT /api/v1/commands/plugin-storage/:key`
- `DELETE /api/v1/commands/plugin-storage/:key`
- `POST /api/v1/commands/plugin-storage/bulk`

Client wrappers live in `src/ts/server/commands.ts`; server validation and
mutation logic lives in `server/fastify/src/routes/commands.ts` plus
`server/fastify/src/commands/plugins.ts` and `pluginStorage.ts`.

## MCP Runtime

MCP and tool orchestration mostly lives under `src/ts/process/mcp/`. MCP
initialization reads MCP URLs from currently active modules via
`getModuleMcps()` in `src/ts/process/modules.ts`: global enabled modules,
current chat modules, current character modules, and prompt-preset/global
`moduleIntergration` entries.

| Path                                                                                                       | Purpose                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/ts/process/mcp/mcp.ts`                                                                                | Runtime registry, URL parsing, tool discovery/calls, OAuth refresh persistence, module import helper. |
| `src/ts/process/mcp/mcplib.ts`                                                                             | Remote Streamable HTTP MCP client with legacy SSE fallback.                                           |
| `src/ts/process/mcp/internalmcp.ts`                                                                        | Base class for internal MCP-like clients.                                                             |
| `src/ts/process/mcp/pluginmcp.ts`                                                                          | Plugin-registered MCP modules using `plugin:` identifiers.                                            |
| `src/ts/process/mcp/risuaccess/`                                                                           | Internal Risu access tools for characters, chats, and modules.                                        |
| `src/ts/process/mcp/aiaccess.ts`, `googlesearchclient.ts`, `graphmem.ts`, `dice.ts`, `filesystemclient.ts` | Internal tool clients.                                                                                |

Supported MCP URL forms:

- `internal:*` for bundled clients such as Risu access, AI access, filesystem,
  Google search, graph memory, and dice.
- `plugin:*` for MCP modules registered by Plugin V3 code.
- `http://` or `https://` for remote MCP servers using Streamable HTTP first
  and legacy SSE fallback.
- `stdio:{...}` only when the JSON wrapper contains a URL. Command-based stdio
  MCPs are rejected in the browser runtime.

Plugin V3 exposes `risuai.registerMCP` and `risuai.unregisterMCP`, which add or
remove `plugin:` MCP clients in the browser registry. Registration alone does
not create a persisted MCP module row; activation still depends on active module
MCP URLs or additional runtime MCP lists.

`internal:risuai` is always available as a call-only client. Risu access write
tools ask for user confirmation and dispatch command-backed writes where
Fastify mode supports them. Current Fastify-backed writes cover character info,
character lorebooks, character regex scripts, character Lua triggers, module
info, module lorebooks, module regex scripts, and module Lua triggers; character
additional asset reference edits still return an unsupported Fastify-mode
response.

## Fastify-Mode Limits

MCP module import is currently blocked in Fastify server-backed mode, and
command-based stdio MCPs are not supported in the browser runtime. This does not
block ordinary `.risum` module import: non-MCP `.risum` files are decoded in the
browser, have embedded assets uploaded through server asset helpers, and are
created through command-backed module helpers. The `.risum` path rejects module
metadata containing `mcp` before asset upload or optimistic module creation, and
server validators still intentionally disallow `mcp` records in generic module
commands. Adding MCP import/update back needs a dedicated command-backed module
route rather than a direct browser mutation.

OAuth refresh token persistence for remote MCP servers writes
`Database.authRefreshes` through server-backed settings patches in Fastify mode.
Google Search MCP credentials are currently unsupported in server-backed web
mode. Remote MCP tool results may contain text, image/audio base64, or resource
payloads, but they are not server-persisted unless a later command stores them.

## UI Surfaces

- `src/lib/Setting/Pages/PluginSettings.svelte` manages installed plugins and
  plugin arguments.
- `src/lib/Playground/PlaygroundMCP.svelte` lists MCP metadata/tools and can run
  tool calls for debugging.
- `src/lib/Setting/Pages/Module/ModuleSettings.svelte` can display existing MCP
  module records and exposes the import UI, but Fastify mode still lacks
  command-backed MCP module create/update support.
