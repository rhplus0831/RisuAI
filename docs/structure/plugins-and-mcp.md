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
| `src/ts/pluginCommands.ts`                                   | Browser command wrappers for plugin records, provider selection, plugin storage, and settings-adjacent compatibility writes. |
| `server/fastify/src/commands/plugins.ts`, `pluginStorage.ts` | Server validation for plugin records and plugin key/value JSON storage.                       |

Plugin records live in `Database.plugins` and use the plugin `name` as the
stable id. `currentPluginProvider` selects a plugin-defined provider when one is
active. Plugin providers remain browser compatibility surfaces; Fastify
chat/completion does not execute plugin provider code.

Plugin V3 code runs through an iframe RPC boundary. API functions must accept
and return serializable data, callback functions, marked remote class instances,
or abort signals. Plugin V2 records can still load for browser-side
compatibility warnings, but Plugin V2 edit/replacer hooks make server prompt
assembly return `unsupported`; Fastify never executes browser plugin code.
Server Lua scripting is separate from browser plugins.

## Plugin Storage

- Server-backed plugin custom storage is `Database.pluginCustomStorage`, mutated
  through `PUT /api/v1/commands/plugin-storage/:key`,
  `DELETE /api/v1/commands/plugin-storage/:key`, or the bulk command route.
- Device-local plugin storage wraps `localStorage`, IndexedDB, and localforage
  through safe prefixes. In Fastify mode it is disabled unless
  `pluginCompatibilityMode` is enabled, and remains plugin sandbox
  compatibility/cache storage rather than app database or backup persistence.

Plugin API calls that patch settings, modules, characters, chats, lorebooks, or
scripts should use command-backed helpers. Unsupported direct resource keys stay
blocked in server-backed mode so plugin code cannot silently mutate projection
state.

## MCP Runtime

MCP and tool orchestration mostly lives under `src/ts/process/mcp/`. MCP
initialization reads MCP URLs from currently active modules via
`getModuleMcps()` in `src/ts/process/modules.ts`.

| Path                                                                                                       | Purpose                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/ts/process/mcp/mcp.ts`                                                                                | Runtime registry, URL parsing, tool discovery/calls, OAuth refresh persistence, module import helper. |
| `src/ts/process/mcp/mcplib.ts`                                                                             | Remote HTTP/SSE JSON-RPC MCP client.                                                                  |
| `src/ts/process/mcp/internalmcp.ts`                                                                        | Base class for internal MCP-like clients.                                                             |
| `src/ts/process/mcp/pluginmcp.ts`                                                                          | Plugin-registered MCP modules using `plugin:` identifiers.                                            |
| `src/ts/process/mcp/risuaccess/`                                                                           | Internal Risu access tools for characters, chats, and modules.                                        |
| `src/ts/process/mcp/aiaccess.ts`, `googlesearchclient.ts`, `graphmem.ts`, `dice.ts`, `filesystemclient.ts` | Internal tool clients.                                                                                |

Supported MCP URL forms:

- `internal:*` for bundled clients such as Risu access, AI access, filesystem,
  Google search, graph memory, and dice.
- `plugin:*` for MCP modules registered by Plugin V3 code.
- `http://` or `https://` for remote MCP servers.
- `stdio:{...}` only when the JSON wrapper contains a URL. Command-based stdio
  MCPs are rejected in the browser runtime.

`internal:risuai` is always available as a call-only client. Risu access write
tools ask for user confirmation and dispatch command-backed writes where
Fastify mode supports them.

## Fastify-Mode Limits

MCP module import is currently blocked in Fastify server-backed mode after the
client validates module metadata. Generic module commands exist, but server
validators intentionally disallow `mcp` records there; adding MCP import/update
back needs a dedicated command-backed module route rather than a direct browser
mutation.

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
