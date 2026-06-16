# Module Settings Audit

Status: bad - at least one likely optimistic/persistence parity problem remains.

## Scope

Audited module settings UI, module command wrappers, and Fastify module commands for user-input changes. Focus areas were text fields, `backgroundEmbedding`, regex/script and trigger editors, prompt-fragment text (`customModuleToggle`), toggles, module ordering/link ordering, and whether edits are both applied optimistically and persisted.

## Files Inspected

- `STRUCTURE.md`
- `src/lib/Setting/Pages/Module/ModuleSettings.svelte`
- `src/lib/Setting/Pages/Module/ModuleMenu.svelte`
- `src/lib/Setting/Pages/Module/ModuleChatMenu.svelte`
- `src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts`
- `src/ts/moduleCommands.ts`
- `src/ts/moduleCommands.test.ts`
- `src/ts/server/commands.ts`
- `src/ts/server/lorebookBridge.svelte.ts`
- `src/ts/server/scriptDefinitionBridge.svelte.ts`
- `src/ts/server/commands.test.ts`
- `src/ts/process/modules.ts`
- `src/ts/stores.modulesEffect.svelte.test.ts`
- `src/ts/compatibilityAdapters.test.ts`
- `src/ts/plugins/plugins.test.ts`
- `server/fastify/src/commands/modules.ts`
- `server/fastify/src/commands/scriptDefinitions.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/__tests__/commands.test.ts`

## Findings

### 1. Global module enable/create/delete are persisted but not applied optimistically

`ModuleSettings.svelte` invokes command wrappers for global enable, create, edit, and delete actions (`src/lib/Setting/Pages/Module/ModuleSettings.svelte:129`, `src/lib/Setting/Pages/Module/ModuleSettings.svelte:183`, `src/lib/Setting/Pages/Module/ModuleSettings.svelte:235`, `src/lib/Setting/Pages/Module/ModuleSettings.svelte:247`). In server-backed mode, only `updateGlobalModule` applies a local optimistic write before dispatching the PATCH command (`src/ts/moduleCommands.ts:168`-`src/ts/moduleCommands.ts:181`).

By contrast, `setGlobalModuleEnabled`, `createGlobalModule`, and `deleteGlobalModule` capture a rollback snapshot and dispatch the server command, but return before mutating `DBState.db.enabledModules` or `DBState.db.modules` (`src/ts/moduleCommands.ts:140`-`src/ts/moduleCommands.ts:161`, `src/ts/moduleCommands.ts:192`-`src/ts/moduleCommands.ts:196`). The non-server fallback branches do mutate local state (`src/ts/moduleCommands.ts:147`-`src/ts/moduleCommands.ts:165`, `src/ts/moduleCommands.ts:199`-`src/ts/moduleCommands.ts:201`), which makes Fastify behavior visibly different.

Persistence itself is present: Fastify creates, patches, enables, reorders, relinks, and deletes modules through command routes (`server/fastify/src/routes/commands.ts:5270`, `server/fastify/src/routes/commands.ts:5306`, `server/fastify/src/routes/commands.ts:5343`, `server/fastify/src/routes/commands.ts:5378`, `server/fastify/src/routes/commands.ts:5422`, `server/fastify/src/routes/commands.ts:5459`), and the integration test confirms persisted module fields and cleanup after delete (`server/fastify/__tests__/commands.test.ts:7663`-`server/fastify/__tests__/commands.test.ts:7797`). The issue is the missing optimistic projection update for the global UI path.

Impact: clicking the global enable icon can leave the row visually unchanged until a projection refresh arrives; create/delete can similarly leave the list stale after the user leaves edit/list mode. The edit path feels immediate, but these neighboring actions do not.

Suggested fix:

- In `setGlobalModuleEnabled`, mutate `DBState.db.enabledModules` under `withTrustedServerProjectionWrite()` before dispatching, then keep the existing rollback snapshot for failures.
- In `createGlobalModule`, push the cloned module under `withTrustedServerProjectionWrite()` before dispatching.
- In `deleteGlobalModule`, remove the module and all local references under `withTrustedServerProjectionWrite()` before dispatching, mirroring the server cleanup shape as far as the projected client state has data available.
- Keep existing server commands unchanged unless a narrower response/reconcile event is desired.

Suggested tests:

- Extend `src/ts/moduleCommands.test.ts` to assert that server-backed `setGlobalModuleEnabled`, `createGlobalModule`, and `deleteGlobalModule` immediately update `DBState.db`, and roll back on a failing command.
- Add/update a `ModuleSettings.svelte` test that does not mock away the optimistic wrapper behavior, or add a focused wrapper-level test that verifies the row/list state transitions the UI depends on.

## Non-Findings / Covered Paths

- Module text fields and prompt fragments are sent through `updateGlobalModule`: basic info binds `name`, `description`, `namespace`, `hideIcon`, and `customModuleToggle` (`src/lib/Setting/Pages/Module/ModuleMenu.svelte:272`-`src/lib/Setting/Pages/Module/ModuleMenu.svelte:283`), and submit calls `updateGlobalModule` with the edited draft (`src/lib/Setting/Pages/Module/ModuleSettings.svelte:243`-`src/lib/Setting/Pages/Module/ModuleSettings.svelte:249`). The wrapper includes scalar fields in the PATCH payload (`src/ts/moduleCommands.ts:284`-`src/ts/moduleCommands.ts:290`), and the server accepts these scalars including `backgroundEmbedding` and `customModuleToggle` (`server/fastify/src/commands/modules.ts:19`-`server/fastify/src/commands/modules.ts:28`).
- `backgroundEmbedding` is bound in the regex submenu (`src/lib/Setting/Pages/Module/ModuleMenu.svelte:323`-`src/lib/Setting/Pages/Module/ModuleMenu.svelte:329`), covered by a UI test (`src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts:270`-`src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts:295`), and covered by wrapper rollback tests (`src/ts/moduleCommands.test.ts:308`-`src/ts/moduleCommands.test.ts:347`) and server persistence tests (`server/fastify/__tests__/commands.test.ts:7717`-`server/fastify/__tests__/commands.test.ts:7793`).
- Module regex and trigger definitions have separate watcher-backed command paths: the module editor installs module-scoped watchers (`src/lib/Setting/Pages/Module/ModuleMenu.svelte:39`-`src/lib/Setting/Pages/Module/ModuleMenu.svelte:56`), script/trigger replacements dispatch module-specific PUT commands (`src/ts/server/scriptDefinitionBridge.svelte.ts:242`-`src/ts/server/scriptDefinitionBridge.svelte.ts:304`), and Fastify persists those arrays on the module row (`server/fastify/src/routes/commands.ts:6097`-`server/fastify/src/routes/commands.ts:6178`).
- Module lorebook edits also have a scoped watcher/discrete-command path from the module editor (`src/lib/Setting/Pages/Module/ModuleMenu.svelte:82`-`src/lib/Setting/Pages/Module/ModuleMenu.svelte:98`) into Fastify module lorebook routes (`server/fastify/src/routes/commands.ts:5841`-`server/fastify/src/routes/commands.ts:6023`).
- Chat-scoped and character-scoped module toggles are optimistic and persisted: the UI calls `toggleSelectedChatModule` and `toggleSelectedCharacterModule` (`src/lib/Setting/Pages/Module/ModuleChatMenu.svelte:93`-`src/lib/Setting/Pages/Module/ModuleChatMenu.svelte:101`), and the wrappers write local state before dispatching chat/character commands (`src/ts/moduleCommands.ts:229`-`src/ts/moduleCommands.ts:269`).
