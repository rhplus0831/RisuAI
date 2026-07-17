# Plugin API v3 setters resolve before their server mutations settle

- **Severity:** High
- **Affected surfaces:** plugin iframe RPC and plugin-provided UI; character/chat projections exposed to plugins; `SET-17` only as a downstream consumer of `plugins[].realArg`
- **Primary locations:** `src/ts/plugins/apiV3/v3.svelte.ts:1200-1218,1228-1253,1267-1303`; `src/ts/plugins/plugins.svelte.ts:1212-1236`

## Trigger

A v3 plugin uses the documented awaitable setters, for example:

```ts
await risuai.setArgument('key', 'value')
await risuai.setCharacter(character)
await risuai.setCharacterToIndex(index, character)
await risuai.setChatToIndex(characterIndex, chatIndex, chat)
```

The plugin then reports success, reads the value back, or performs a dependent mutation after the `await` resolves.

## Expected behavior

The Promise returned by an API v3 setter should represent its mutation acknowledgement. It should resolve with a truthful accepted/queued outcome, or reject/report a terminal persistence failure. This is especially important because the public API explicitly says all calls are asynchronous and must be awaited (`src/ts/plugins/apiV3/risuai.d.ts:8-19`) and declares these setters as `Promise<void>` (`src/ts/plugins/apiV3/risuai.d.ts:1266-1306,1352-1359`).

## Actual behavior

The Promise only represents the iframe RPC call, not the server mutation:

- `setArgument` is declared `async`, but calls `dispatchUpdatePlugin(...)` without returning or awaiting its `Promise<PluginMutationOutcome>` (`src/ts/plugins/apiV3/v3.svelte.ts:1200-1218`; `src/ts/pluginCommands.ts:363-417`).
- `setCharacterToIndex` applies the optimistic character and invokes the fire-and-forget `preparation.dispatch()` (`src/ts/plugins/apiV3/v3.svelte.ts:1228-1253`).
- `setChatToIndex` replaces the local chat and invokes another fire-and-forget `dispatch()` (`src/ts/plugins/apiV3/v3.svelte.ts:1267-1289`).
- `setCharacter` aliases the legacy synchronous `setChar` implementation (`src/ts/plugins/apiV3/v3.svelte.ts:1300-1303`), which also applies an optimistic row and calls `preparation.dispatch()` (`src/ts/plugins/plugins.svelte.ts:1212-1236`).

The iframe host awaits only the value returned by each handler (`src/ts/plugins/apiV3/factory.ts:645-667`). Because these handlers return before the durable dispatcher settles, the RPC sends a successful response immediately. A later terminal conflict, validation error, or rejection can roll the optimistic field back, but the plugin never receives that outcome. A retained transport failure is likewise indistinguishable from server acceptance.

## Underlying cause

The compatibility preparation objects expose both `dispatch()` and `dispatchAsync()`, but the v3 bridge uses the void version. The character implementation explicitly defines `dispatch: () => void dispatchAsync()` (`src/ts/characterCommands.ts:1236-1249`); the chat bridge follows the same pattern (`src/ts/chatCommands.ts:3081-3094`). The plugin argument path already has a typed accepted/queued/failed outcome, but discards it.

## Affected data flow

### Plugin argument

1. The plugin RPC mutates `plugins[].realArg` in the shared client resource projection (`src/ts/plugins/apiV3/v3.svelte.ts:1200-1215`).
2. `dispatchUpdatePlugin` stages a durable `PATCH /plugins/:pluginId` intent and returns a typed mutation outcome (`src/ts/pluginCommands.ts:371-417`).
3. Fastify validates the patch, updates the plugins collection row, and responds with the new revision and `plugin.updated` event (`server/fastify/src/routes/commands.ts:7796-7837`).
4. The outcome is ignored by the v3 handler. Terminal rollback or retained projection handling occurs later in the command owner, after the plugin's Promise has already resolved.

### Character and chat setters

1. The bridge replaces the current client row optimistically.
2. The scoped compatibility owner derives one or more revisioned character/chat command steps and stages them in the durable outbox (`src/ts/characterCommands.ts:1218-1249`; `src/ts/chatCommands.ts:3077-3094`).
3. Client commands send `PATCH /characters/:characterId` or the relevant chat metadata/message/script-state requests (`src/ts/server/commands.ts:3358-3372,3485-3500`).
4. Fastify persists accepted character and chat rows and returns revisioned events (`server/fastify/src/routes/commands.ts:5076-5131,5496-5559`).
5. The durable owner acknowledges, retains, or rolls back the projection, but none of that state reaches the already-resolved plugin call.

## User impact

Plugin UIs can display a successful save even though Fastify rejected it, then appear to revert later. More seriously, plugin logic that chains a second operation after `await` can run under the false assumption that the first row is durable, producing inconsistent plugin, character, and chat state. The problem affects third-party code precisely at the API boundary that is supposed to provide sequencing.

## Recommended fix

- Have every v3 mutating handler return the real asynchronous dispatcher: return/await `dispatchUpdatePlugin(...)` and use `dispatchAsync()` for character/chat compatibility bridges.
- Standardize a serializable v3 mutation result such as `{ status: 'accepted' | 'queued' | 'failed', ... }`. If preserving `Promise<void>`, resolve only for accepted or durably queued work and reject terminal failures; document that queued does not yet mean server-applied.
- Do not expose a successful RPC response before the durable staging decision is known.
- Add RPC-level tests in which the dispatcher Promise is deferred, proving that the plugin-facing Promise stays pending and that terminal failure is observable.
