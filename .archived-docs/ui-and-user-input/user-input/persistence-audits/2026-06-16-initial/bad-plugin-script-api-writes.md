# Plugin / Script API Write Audit

Status: bad

Scope audited: Plugin API V3, legacy plugin APIs, Lua/script-related write helpers, and MCP `internal:risuai` write paths that can change characters, chats, lorebooks, scripts/triggers, modules, settings, plugin storage, or messages.

## Findings

### 1. Plugin API V3 `setChatToIndex` can leave unsupported chat fields as client-only projection writes

- `setChatToIndex` writes the whole plugin-supplied chat object into `DBState.db.characters[charId].chats[chatIndex]` before it builds server commands (`src/ts/plugins/apiV3/v3.svelte.ts:1153-1168`).
- The command builder only persists chat metadata allowlisted in `CHAT_PATCH_ALLOWED_KEYS`, full `message` replacement, and `scriptstate` patches (`src/ts/chatCommands.ts:46-59`, `src/ts/chatCommands.ts:790-832`).
- The metadata sanitizer explicitly strips every non-allowlisted chat field (`src/ts/chatCommands.ts:1520-1526`), and the diff only considers those accepted metadata keys (`src/ts/chatCommands.ts:1554-1568`).

Impact: if a plugin changes only a non-command-backed chat field such as `localLore`, `generationSettings`, memory payloads, or another omitted chat property, the projection is mutated locally, no command factory is produced, and `runOptimisticCommandSequence` returns without rollback. If the plugin changes supported and unsupported fields together, the supported fields persist while the unsupported fields remain as a dangling local projection edit until a later server projection overwrites them.

This is the clearest instance of a plugin/user-driven write mutating projection without a matching durable command.

### 2. MCP RisuAccess write tools dispatch server commands without first applying the requested change to `DBState`

Several MCP write tools build an edited clone and immediately dispatch a command in server-backed mode, while the local mutation is only performed in the non-server branch:

- Character info dispatches `dispatchUpdateCharacterScoped(...)` but does not assign the patch locally first (`src/ts/process/mcp/risuaccess/characters.ts:557-568`).
- Character lorebook add/update/delete dispatches `dispatchReplaceCharacterLorebooks(...)`; `char.globalLore = entries` is only in the non-server branch (`src/ts/process/mcp/risuaccess/characters.ts:610-663`, `src/ts/process/mcp/risuaccess/characters.ts:700-718`).
- Character regex and Lua writes dispatch `dispatchReplaceCharacterScripts(...)` / `dispatchReplaceCharacterTriggers(...)`; `char.customscript` / `char.triggerscript` assignment is only in the non-server branch (`src/ts/process/mcp/risuaccess/characters.ts:795-837`, `src/ts/process/mcp/risuaccess/characters.ts:875-894`, `src/ts/process/mcp/risuaccess/characters.ts:1034-1041`).
- Module info dispatches `dispatchUpdateModule(...)` / `dispatchEnableModule(...)` without applying the module field or enabled-state change locally (`src/ts/process/mcp/risuaccess/modules.ts:468-489`).
- Module lorebook, regex, and Lua writes have the same pattern (`src/ts/process/mcp/risuaccess/modules.ts:600-654`, `src/ts/process/mcp/risuaccess/modules.ts:684-703`, `src/ts/process/mcp/risuaccess/modules.ts:771-813`, `src/ts/process/mcp/risuaccess/modules.ts:846-866`, `src/ts/process/mcp/risuaccess/modules.ts:918-926`).

The dispatch helpers they call queue or fire `runServerCommand` but do not apply the payload to projection themselves (`src/ts/server/lorebookBridge.svelte.ts:919-996`, `src/ts/server/lorebookBridge.svelte.ts:1343-1352`, `src/ts/server/scriptDefinitionBridge.svelte.ts:178-239`, `src/ts/server/scriptDefinitionBridge.svelte.ts:242-303`).

Impact: the tool returns a success message before local state reflects the requested write. A later SSE/projection update may repair the view, but immediate reads from the MCP tool, UI, or script runtime can see stale data. If the event stream is absent, delayed, or resync fails, the client remains inconsistent with the accepted write. This also differs from the normal command-backed UI/plugin pattern, where the optimistic projection is applied first and rollback restores it on failure.

### 3. MCP `risu-set-module-info` can fan out multiple commands against one cached revision

When `risu-set-module-info` receives both normal module fields and `enabled`, it calls `dispatchUpdateModule(...)` and `dispatchEnableModule(...)` back-to-back without sequencing (`src/ts/process/mcp/risuaccess/modules.ts:483-489`). Those helpers fire `void runServerCommand(...)` independently (`src/ts/moduleCommands.ts:99-139`).

`getServerCommandBaseRevision` returns the cached revision immediately when present (`src/ts/server/commands.ts:1141-1146`), and each `runServerCommand` uses the base revision it read before posting (`src/ts/server/commands.ts:2813-2826`). Two unsequenced commands can therefore race with the same `baseRevision`; one can succeed and advance the server revision while the other receives a conflict.

Impact: one half of a combined MCP module-info update can be lost. Because this path also does not apply an optimistic projection first, the user may receive a success message from the tool even though one command failed asynchronously.

### 4. Legacy `setChar` and V3 character setters silently omit split resource fields

The legacy plugin `setChar` API and V3 `setCharacterToIndex` both route through `prepareCompatibleCharacterUpdate` (`src/ts/plugins/plugins.svelte.ts:861-883`, `src/ts/plugins/apiV3/v3.svelte.ts:1113-1138`). That path sanitizes the diff before applying the optimistic character (`src/ts/characterCommands.ts:481-529`).

The sanitizer drops `chats`, `chatFolders`, `globalLore`, `customscript`, `triggerscript`, `scriptstate`, `modules`, `coldstorage`, and `coldStoragedChats` (`src/ts/characterCommands.ts:74-85`, `src/ts/characterCommands.ts:922-954`).

Impact: this avoids a dangling projection write, but it still silently ignores plugin-provided changes to split resources. For old plugins that expect `setChar(getCharWithEditedLoreOrScripts)` to update the whole character, lorebook/script/module/chat changes are lost without an error or warning. These fields should either be routed through dedicated commands or rejected loudly in server-backed mode.

## Checked Paths That Look Command-Backed

- Plugin V3 theme/settings APIs apply the local setting first and dispatch grouped settings patches with rollback (`src/ts/plugins/apiV3/v3.svelte.ts:990-1058`).
- Legacy plugin DB bridge blocks known unsupported resource families in server-backed mode rather than shadowing them into plugin storage (`src/ts/plugins/plugins.svelte.ts:663-711`).
- Plugin storage helpers apply local plugin storage first and then dispatch plugin-storage commands with rollback (`src/ts/plugins/plugins.svelte.ts:614-638`).
- Plugin collection/module collection compatibility writes apply local projection first, then dispatch command sequences for create/update/delete/reorder (`src/ts/plugins/plugins.svelte.ts:673-706`, `src/ts/plugins/plugins.svelte.ts:735-806`).

## Suggested Fix Direction

For plugin chat writes, compute the sanitized/command-backed projection first and only apply that subset, or reject unsupported chat fields before touching `DBState`.

For MCP RisuAccess writes, mirror the UI bridge pattern: apply the exact accepted projection change inside `withTrustedServerProjectionWrite`, then dispatch the command with a rollback snapshot. Multi-command MCP updates should use the existing `runOptimisticCommandSequence` style so all subcommands advance one revision baseline.
