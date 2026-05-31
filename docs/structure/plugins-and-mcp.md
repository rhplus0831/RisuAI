# Plugins And MCP

Plugins and MCP tooling are browser runtime features with server-backed records.
Fastify stores plugin records, plugin storage, settings, and module state, but it
does not execute browser plugin code.

## Plugin Runtime

Core files:

| Path                                           | Purpose                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/ts/plugins/plugins.svelte.ts`             | Plugin import/update/load, V2 compatibility, custom providers, and command-backed state dispatch. |
| `src/ts/plugins/apiV3/v3.svelte.ts`            | Plugin API V3 surface exposed to sandboxed plugins.                                               |
| `src/ts/plugins/apiV3/factory.ts`              | `SandboxHost` iframe/RPC bridge between the app and plugin guest code.                            |
| `src/ts/plugins/pluginSafeClass.ts`            | Safe storage, DOM/document wrappers, and device-local storage gates.                              |
| `src/ts/plugins/pluginSafety.ts`               | Static safety rewrite/check for imported plugin code.                                             |
| `src/ts/pluginCommands.ts`                     | Browser command wrappers for plugin records and plugin custom storage.                            |
| `server/fastify/src/commands/plugins.ts`       | Server validation for plugin records and provider selection.                                      |
| `server/fastify/src/commands/pluginStorage.ts` | Server validation for plugin key/value JSON storage.                                              |

Plugin records live in `Database.plugins` and use the plugin `name` as the
stable id. `currentPluginProvider` selects a plugin-defined provider when one is
active.

Plugin V3 code runs through an iframe RPC boundary. API functions must accept
and return serializable data, callback functions, marked remote class instances,
or abort signals. The host exposes aliases and properties during initialization.

Plugin V2 records can still be loaded for browser-side compatibility warnings,
but Plugin V2 edit/replacer hooks are intentionally not executed by the Fastify
server prompt assembler. Do not treat server Lua scripting as a replacement for
browser plugin execution; they are separate systems.

## Plugin Storage

There are two storage classes:

- Server-backed plugin custom storage is `Database.pluginCustomStorage`, mutated
  through `PUT /api/v1/commands/plugin-storage/:key`,
  `DELETE /api/v1/commands/plugin-storage/:key`, or the bulk command route.
- Device-local plugin storage wraps `localStorage`, IndexedDB, and localforage
  through safe prefixes. In Fastify mode it is disabled unless
  `pluginCompatibilityMode` is enabled.

Plugin API calls that patch settings, modules, characters, chats, lorebooks, or
scripts should use the command-backed helpers. Unsupported direct resource keys
remain blocked in server-backed mode so plugin code cannot silently mutate the
read-only projection.

## MCP Runtime

MCP and tool orchestration lives under `src/ts/process/mcp/`.

| Path                                                                                    | Purpose                                                                                                         |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `mcp.ts`                                                                                | Runtime registry, URL parsing, tool discovery, tool calls, OAuth refresh persistence, and module import helper. |
| `mcplib.ts`                                                                             | Remote HTTP/SSE JSON-RPC MCP client.                                                                            |
| `internalmcp.ts`                                                                        | Base class for internal MCP-like clients.                                                                       |
| `pluginmcp.ts`                                                                          | Plugin-registered MCP modules using `plugin:` identifiers.                                                      |
| `risuaccess/`                                                                           | Internal Risu access tools for characters, chats, and modules.                                                  |
| `aiaccess.ts`, `googlesearchclient.ts`, `graphmem.ts`, `dice.ts`, `filesystemclient.ts` | Internal tool clients.                                                                                          |

Supported MCP URL forms:

- `internal:*` for bundled clients such as Risu access, AI access, filesystem,
  Google search, graph memory, and dice.
- `plugin:*` for MCP modules registered by Plugin V3 code.
- `http://` or `https://` for remote MCP servers.
- `stdio:{...}` only when the JSON wrapper contains a URL. Command-based stdio
  MCPs are rejected in the browser runtime.

`internal:risuai` is always available as a call-only client so tool calls can
reach Risu access even when the module list does not include it. Risu access
write tools ask for user confirmation and dispatch command-backed writes where
Fastify mode supports them.

## Fastify-Mode Limits

MCP module import is currently blocked in Fastify server-backed mode after the
client validates the module metadata. Adding it back needs a command-backed
module import route rather than a direct browser mutation.

OAuth refresh token persistence for remote MCP servers writes
`Database.authRefreshes` through server-backed settings patches in Fastify mode.

Google Search MCP credentials and other browser-only tool details remain
client-side. Remote MCP tool results may contain text, image/audio base64, or
resource payloads, but they are not server-persisted unless a later command
explicitly stores them.

## UI Surfaces

- `src/lib/Setting/Pages/PluginSettings.svelte` manages installed plugins and
  plugin arguments.
- `src/lib/Playground/PlaygroundMCP.svelte` lists MCP metadata/tools and can
  execute tool calls for debugging.
- `src/lib/Setting/Pages/Module/ModuleSettings.svelte` is where MCP module URLs
  are associated with modules outside the blocked import helper.
