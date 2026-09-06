# DL2 Pass 4 report — codex

## Checks

- Bounded CharX imports (`dc84d3da1`, `85e808621`) — FINDING DL2-P4-1 — `src/ts/process/processzip.ts:349-354,426-439` excludes over-50 MiB entries without adding a completion error, while `src/ts/characterCards.ts:181-210` never checks `excludedFiles` before importing. `docs/structure/assets-and-saves.md:189-193` also confirms aborts leave uploaded assets to later grace-window GC rather than rolling them back.
- Character/lorebook identity normalization at import and server boundaries (`c80c75126`, `d89b0c6d4`, `88066c2a8`) — FINDING DL2-P4-2 — Chats and assets remain embedded with a reminted character, and lorebook repairs re-read inside `withTrustedResourceWrite` then force a full replacement while identity-dirty (`src/ts/server/lorebookBridge.svelte.ts:980-1036,2159-2167`). Portable greeting rows are detached before character-ID normalization, however (`server/fastify/src/risuSave/importSnapshot.ts:243-253`).
- Post-import greeting display (`64acdef60`) — SAFE — The change is not literally read-only, but `chat.fmIndex ??= character.firstMsgIndex ?? -1` only fills a nullish field on the new import and preserves supplied indices and all greeting text (`src/ts/characterCards.ts:103-121`). The intact empty starter chat is then snapshotted for durable create (`src/ts/characterCommands.ts:2306-2318`).

## Findings

### DL2-P4-1 — CharX bounds permit successful incomplete imports

- Severity: medium / Confidence: certain
- Evidence: `src/ts/process/processzip.ts:349-354` says `if (originalSize > MAX_ASSET_SIZE_BYTES) { this.#markFileExcluded(assetIndex); return }`; `src/ts/process/processzip.ts:301-313,433-439` rejects completion only for save errors and merely records excluded names. The caller conditionally reads `moduleData` but otherwise proceeds through `await importer.done()` to character import without inspecting exclusions (`src/ts/characterCards.ts:181-210`). This matters for native exports because scripts and triggers are moved into `module.risum` and removed from `card.json` (`src/ts/characterCards.ts:1561-1577`). A second partial-success path alerts and skips an oversized CCv3 data URI, omits its unresolved asset, and still appends the character (`src/ts/characterCards.ts:878-905,1041-1051`). By contrast, incomplete `.risu` blocks throw before normalization/application (`server/fastify/src/risuSave/importSnapshot.ts:136-143`).
- Loss scenario: a user imports a valid CharX whose `module.risum` exceeds 50 MiB and contains module-only custom scripts/triggers → the importer records and skips the module, `done()` resolves, and the caller reports a successful character import → the newly durable character silently lacks those scripts/triggers. Likewise, an oversized declared data-URI asset is omitted while the character still persists.
- Fix direction: Make any excluded CharX entry or oversized declared asset reject the whole import with a stable, user-visible incomplete-import error. Track assets created by the import and remove newly created rows/files on every later abort, preserving pre-existing content-addressed assets.

### DL2-P4-2 — Character-ID repair misowns portable greeting translations

- Severity: medium / Confidence: certain
- Evidence: `normalizeImportDatabase()` extracts portable greeting rows before normalizing the database (`server/fastify/src/risuSave/importSnapshot.ts:243-253`), and extraction stamps each row with the character's pre-normalization `chaId` (`server/fastify/src/risuSave/importSnapshot.ts:291-305`). `ensureCharacterCollection()` keeps the first duplicate character ID but assigns later duplicates a new UUID (`server/fastify/src/commands/characters.ts:72-80`). The import transaction then writes normalized characters and the already-extracted rows separately (`server/fastify/src/repository.ts:2333-2339`); the greeting table keys rows by `character_id` (`server/fastify/src/translation/greetingTranslationStore.ts:44-54`).
- Loss scenario: a portable `.risu` contains characters A and B with the same legacy `chaId`, each with a source-valid greeting translation under a distinct settings hash → extraction assigns both rows to the shared old ID, then normalization remints B's ID → import commits both translation rows under A; B's translated greeting is no longer retrievable under B and is durably misassociated/hidden.
- Fix direction: Normalize character identities before detaching portable greeting rows, or carry an index-based old-to-final identity mapping through extraction. If dependent references cannot be mapped unambiguously, reject duplicate character IDs atomically instead of repairing only the character row.

## Free-hunt findings

None.

## Not examined

- None within the three assigned checks; all were traced at HEAD. Per the charter, pre-delta July `db.json` boot-import internals, general asset-GC correctness, whole-save round-trip completeness, and unrelated export/destructive flows were not re-audited.
- No runtime or test-suite execution was performed, as required by the brief.

Co-Authored-By: Codex <noreply@openai.com>
