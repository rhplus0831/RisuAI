# Server Command Mutations Audit

Status: bad - one likely persistence issue found.

## Finding

### Accepted character-create chat content is dropped from SQLite side tables

`POST /api/v1/commands/characters` and `POST /api/v1/commands/characters/create-and-select` accept the full `character` object, pass it through `createCharacterRecord`, and then persist via `applyMessageFreeJsonCommandMutation` ([server/fastify/src/routes/commands.ts:3267](../../server/fastify/src/routes/commands.ts#L3267), [server/fastify/src/routes/commands.ts:3273](../../server/fastify/src/routes/commands.ts#L3273), [server/fastify/src/routes/commands.ts:3274](../../server/fastify/src/routes/commands.ts#L3274), [server/fastify/src/routes/commands.ts:3304](../../server/fastify/src/routes/commands.ts#L3304), [server/fastify/src/routes/commands.ts:3310](../../server/fastify/src/routes/commands.ts#L3310), [server/fastify/src/routes/commands.ts:3313](../../server/fastify/src/routes/commands.ts#L3313)).

The validator requires only `chaId` and validates a small set of scalar/asset fields; it does not reject `character.chats`, chat `message[]`, or chat `hypaV3Data` ([server/fastify/src/commands/characters.ts:81](../../server/fastify/src/commands/characters.ts#L81), [server/fastify/src/commands/characters.ts:84](../../server/fastify/src/commands/characters.ts#L84), [server/fastify/src/commands/characters.ts:348](../../server/fastify/src/commands/characters.ts#L348), [server/fastify/src/commands/characters.ts:363](../../server/fastify/src/commands/characters.ts#L363)). The browser helper also sends a full JSON clone of the character, not a sanitized create payload ([src/ts/server/commands.ts:1834](../../src/ts/server/commands.ts#L1834), [src/ts/server/commands.ts:1840](../../src/ts/server/commands.ts#L1840), [src/ts/characterCommands.ts:354](../../src/ts/characterCommands.ts#L354), [src/ts/characterCommands.ts:918](../../src/ts/characterCommands.ts#L918)).

That mutation path explicitly loads and writes a message-free repository view, then calls `stripChatMessages` and the broad table replacers without `syncChatMessages` or any `chat_hypa_v3` writer ([server/fastify/src/commands/mutations.ts:317](../../server/fastify/src/commands/mutations.ts#L317), [server/fastify/src/commands/mutations.ts:329](../../server/fastify/src/commands/mutations.ts#L329), [server/fastify/src/commands/mutations.ts:330](../../server/fastify/src/commands/mutations.ts#L330)). The character table writer also strips `message` and `hypaV3Data` from each chat row because those fields belong to side tables ([server/fastify/src/repository.ts:384](../../server/fastify/src/repository.ts#L384), [server/fastify/src/repository.ts:403](../../server/fastify/src/repository.ts#L403), [server/fastify/src/repository.ts:412](../../server/fastify/src/repository.ts#L412)).

Result: a command caller can create a character with embedded chats and receive a successful revision/event, but any embedded transcript and Hypa V3 body content will not be reflected in bootstrap/projection/hydration. The chat metadata row is persisted, while message hydration will read empty/missing `messages` rows and Hypa hydration will read no `chat_hypa_v3` blob.

Suggested fix: either reject `character.chats` on these create routes and require callers to use the chat/message commands, or move character creation with embedded chats to a hydrated mutation path that writes `messages` and `chat_hypa_v3` side tables atomically.

## Side-Table And Body-Cache Notes

- Message mutations use targeted `messageStore` writers and emit command events after the global revision bump; I did not find a route that writes message JSON without touching the `messages` table ([server/fastify/src/routes/commands.ts:4180](../../server/fastify/src/routes/commands.ts#L4180), [server/fastify/src/routes/commands.ts:4218](../../server/fastify/src/routes/commands.ts#L4218), [server/fastify/src/routes/commands.ts:4319](../../server/fastify/src/routes/commands.ts#L4319), [server/fastify/src/messageStore.ts:397](../../server/fastify/src/messageStore.ts#L397)).
- Module/plugin body cache revisions are updated by the generic collection writers for full-table rewrites and single-row updates, including pruning on delete/reorder ([server/fastify/src/repository.ts:170](../../server/fastify/src/repository.ts#L170), [server/fastify/src/repository.ts:690](../../server/fastify/src/repository.ts#L690), [server/fastify/src/repository.ts:730](../../server/fastify/src/repository.ts#L730), [server/fastify/src/repository.ts:804](../../server/fastify/src/repository.ts#L804), [server/fastify/src/repository.ts:811](../../server/fastify/src/repository.ts#L811), [server/fastify/src/repository.ts:1757](../../server/fastify/src/repository.ts#L1757)).
- Targeted character/chat/lorebook/script commands generally write the matching SQLite row or collection table and emit resources that projection can refresh narrowly ([server/fastify/src/routes/commands.ts:3344](../../server/fastify/src/routes/commands.ts#L3344), [server/fastify/src/routes/commands.ts:3489](../../server/fastify/src/routes/commands.ts#L3489), [server/fastify/src/routes/commands.ts:4980](../../server/fastify/src/routes/commands.ts#L4980), [server/fastify/src/routes/commands.ts:6098](../../server/fastify/src/routes/commands.ts#L6098)).

## Files Inspected

- `STRUCTURE.md` - repo structure and persistence conventions.
- `docs/structure/server-projection-and-bridges.md` - bootstrap, projection, hydration, body-cache expectations.
- `server/fastify/src/routes/commands.ts` - all command routes, validators used at route boundaries, mutation path selection.
- `server/fastify/src/commands/assets.ts`, `characters.ts`, `chats.ts`, `events.ts`, `loadouts.ts`, `lorebooks.ts`, `messages.ts`, `modules.ts`, `mutations.ts`, `personas.ts`, `plugins.ts`, `pluginStorage.ts`, `prompts.ts`, `scriptDefinitions.ts`, `splitPresets.ts`, `presets.ts`, `translatorPresets.ts` - command validators, repair helpers, command event catalog, and mutation helpers.
- `server/fastify/src/repository.ts` and `server/fastify/src/messageStore.ts` - SQLite table writers, message/blob side tables, body-cache revision behavior, bootstrap body cache entries.
- `src/ts/server/commands.ts`, `src/ts/characterCommands.ts`, `src/ts/characterCards.ts`, `src/ts/characters.ts`, plus targeted bridge/hydration references under `src/ts/server/` - client command payload shape and projection/hydration expectations.

No source code was changed as part of this audit.
