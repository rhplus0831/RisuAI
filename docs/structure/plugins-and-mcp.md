# Plugins And MCP

Plugins and MCP tooling are browser runtime features with server-backed records.
Fastify stores plugin records, plugin storage, settings, and module state, but it
does not execute browser plugin code.

## Plugin Runtime

| Path                                                                                     | Purpose                                                                                       |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/ts/plugins/plugins.svelte.ts`                                                       | Plugin import/update/load, V2 compatibility, custom providers, command-backed state dispatch. |
| `src/ts/plugins/apiV3/v3.svelte.ts`                                                      | Plugin API V3 surface exposed to sandboxed plugins.                                           |
| `src/ts/plugins/apiV3/factory.ts`                                                        | `SandboxHost` iframe/RPC bridge between app and plugin guest code.                            |
| `src/ts/plugins/apiV3/transpiler.ts`, `src/ts/plugins/apiV3/developMode.ts`              | Plugin V3 transpilation and development-mode loading.                                         |
| `src/ts/plugins/apiV3/risuai.d.ts`                                                       | Plugin V3 TypeScript declarations for plugin authors.                                         |
| `src/ts/plugins/pluginSafeClass.ts`, `src/ts/plugins/pluginSafety.ts`                    | Safe wrappers, static safety rewrite/checks, device-local storage gates.                      |
| `src/ts/pluginCommands.ts`                                                               | Browser command wrappers for plugin records and plugin custom storage.                        |
| `server/fastify/src/commands/plugins.ts`, `server/fastify/src/commands/pluginStorage.ts` | Server validation for plugin records and plugin key/value JSON storage.                       |

Plugin records live in `Database.plugins` and use the plugin `name` as the
stable id. `currentPluginProvider` selects a plugin-defined provider when one is
active.

Plugin V3 code runs through an iframe RPC boundary. API functions must accept
and return serializable data, callback functions, marked remote class instances,
or abort signals. Plugin V2 records can still load for browser-side
compatibility warnings, but Plugin V2 edit/replacer hooks make server prompt
assembly return `unsupported`; Fastify never executes browser plugin code.
Server Lua scripting is separate from browser plugins.

## Plugin Storage

There are two storage classes:

- Server-backed plugin custom storage is `Database.pluginCustomStorage`, mutated
  through `PUT /api/v1/commands/plugin-storage/:key`,
  `DELETE /api/v1/commands/plugin-storage/:key`, or the bulk command route.
- Device-local plugin storage wraps `localStorage`, IndexedDB, and localforage
  through safe prefixes. In Fastify mode it is disabled unless
  `pluginCompatibilityMode` is enabled.

Plugin API calls that patch settings, modules, characters, chats, lorebooks, or
scripts should use command-backed helpers. Unsupported direct resource keys stay
blocked in server-backed mode so plugin code cannot silently mutate projection
state.

## MCP Runtime

MCP and tool orchestration mostly lives under `src/ts/process/mcp/`. Module
runtime wiring that resolves MCP URLs starts from `src/ts/process/modules.ts`.

| Path                                                                                                                                                                                   | Purpose                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/ts/process/mcp/mcp.ts`                                                                                                                                                            | Runtime registry, URL parsing, tool discovery/calls, OAuth refresh persistence, module import helper. |
| `src/ts/process/mcp/mcplib.ts`                                                                                                                                                         | Remote HTTP/SSE JSON-RPC MCP client.                                                                  |
| `src/ts/process/mcp/internalmcp.ts`                                                                                                                                                    | Base class for internal MCP-like clients.                                                             |
| `src/ts/process/mcp/pluginmcp.ts`                                                                                                                                                      | Plugin-registered MCP modules using `plugin:` identifiers.                                            |
| `src/ts/process/mcp/risuaccess/`                                                                                                                                                       | Internal Risu access tools for characters, chats, and modules.                                        |
| `src/ts/process/mcp/aiaccess.ts`, `src/ts/process/mcp/googlesearchclient.ts`, `src/ts/process/mcp/graphmem.ts`, `src/ts/process/mcp/dice.ts`, `src/ts/process/mcp/filesystemclient.ts` | Internal tool clients.                                                                                |

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
client validates module metadata. Adding it back needs a command-backed module
import route rather than a direct browser mutation.

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
- `src/lib/Setting/Pages/Module/ModuleSettings.svelte` associates MCP module
  URLs with modules outside the blocked import helper.
