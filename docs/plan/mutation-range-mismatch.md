# Command Mutation-Range Mismatch Audit

_Audited 2026-06-03. Scope: all 79 command routes in
`server/fastify/src/routes/commands.ts`, checked against reference fix
`b57df5cd` ("fix: speed up character selection command"). A fan-out classifier
produced the findings; an adversarial verifier re-checked each narrowing claim._

Current note: this file is the frozen seed/before-state audit. Route line numbers
and helper classifications below are audit-time anchors and have drifted as
Phases 0-5 landed. Use [`status.md`](status.md), [`active-risk-analysis.md`](active-risk-analysis.md),
and the phase/slice docs for present-tense runtime status.

## What "mutation-range mismatch" means

A mismatch means a command changes a small state slice but uses a helper that
rewrites much more, or emits a projection resource that refreshes whole arrays.
`b57df5cd` is the template: `characters/select` used to rewrite every character
row, all 9 collection tables, and settings to change `currentChar` plus one
character's `lastInteraction`. It now uses
`applyCharacterSelectionCommandMutation` / `writeCharacterSelectionRows` to write
one character row plus settings, with a narrow `characterSelection` projection.
The metric gate checks `mutationPath: 'targeted-character-selection'` and
`dbJsonWriteMs: 0`.

## The shared mechanism

The JSON `database` is split across SQLite tables in
`server/fastify/src/repository.ts`:

| Logical key(s) | Table(s) | Write granularity available |
| --- | --- | --- |
| every non-collection / non-character top-level key (pointers, scalars, `characterOrder`, `currentChar`, `botPresetsId`, `selectedPersona`, `enabledModules`, `currentPluginProvider`, `loreBookPage`, `translatorPreset*`, `lastLoadedLoadoutName`, …) | `settings` (single row, id=1) | one-row `UPDATE` (cheap) |
| `characters[]` | `characters` (one row per character) | one-row `UPDATE … WHERE id=?` |
| `characters[].chats[]` | `chats` (one row per chat) | one-row `UPDATE … WHERE id=?` |
| `modules`, `plugins`, `botPresets`, `promptTemplate`, `personas`, `loadouts`, `loreBook`, `translatorPresets`, `hypaV3Presets` | 9 position-keyed collection tables | one-table `DELETE`+reinsert, or single-row `UPDATE … WHERE position=?` |
| `pluginCustomStorage` | `plugin_custom_storage` (key/value) | single-key upsert/delete |
| `chats[].message[]`, `hypaV3Data`, alternates | message store | already surgical (`syncChatMessages`, targeted writers) |

The four mutation helpers (`server/fastify/src/commands/mutations.ts`):

| Helper | `mutationPath` | What it physically writes |
| --- | --- | --- |
| `applyJsonCommandMutation` | `hydrated` | loads all chat messages, then `syncChatMessages` (surgical) + rewrites all characters + chats + 9 collection tables + settings |
| `applyMessageFreeJsonCommandMutation` | `message-free` | no message load, but rewrites all characters + chats + 9 collection tables + settings |
| `applyTargetedCommandMutation` | custom | loads message-free db.json for validation; callback does targeted SQLite writes; broad `replaceAll*` runs only with `writeDatabase: true` |
| `applyCharacterSelectionCommandMutation` | `targeted-character-selection` | bespoke reference path: one character row + settings |

### Coverage result

| State | Count | Routes |
| --- | --- | --- |
| Already minimal | 8 | the 6 message commands on `applyTargetedCommandMutation` (3030–3296), `characters/select` (2431), `state/initialize` (1047, first-run seed) |
| Over-broad mutation range | 71 | everything else — 66 on `hydrated`, 5 on `message-free`, all rewriting characters + 9 collection tables + settings for a sub-row change |

So 71 of 79 commands share the shape `b57df5cd` fixed. Post-verification
severity: 51 high, 18 medium, 3 low. "High" means the route rewrites every
character row and/or loads every message for a one-row logical change.

## Cross-cutting prerequisites (apply to almost every finding)

These verifier findings must hold for every slice.

1. Build the targeted writer kit. `repository.ts` has only
   `writeCharacterSelectionRows`, broad `replaceAll*`, and surgical message-store
   writers. Add:
   - `writeSettingsOnly(db, settings)` — `UPDATE settings`.
   - `writeSingleCharacterRow(db, id, character)` — `UPDATE characters WHERE id=?`.
   - `writeSingleChatRow(db, id, chat)` — `UPDATE chats WHERE id=?` (no `UPDATE chats`
     writer exists anywhere today).
   - `writeSingleCollectionTable(db, field, array)` — `DELETE`+reinsert one of the 9
     tables for create/delete/reorder.
   - `writeSingleCollectionRow(db, field, position, value)` — pure field edits.
   - `writePluginStorageKey` / `deletePluginStorageKey`.

2. Treat global normalization as validate-only. Many `mutate` callbacks repair
   sibling rows before the logical edit. Broad paths persist those repairs;
   targeted paths compute them for validation, then write only the target row.
   This matches `b57df5cd` and fits the current project posture: no users, no
   migrations, and backup data may be lost. Each targeted path still normalizes
   its own target row.

3. Co-write settings when needed. A "single row" change often moves a settings
   scalar (`characterOrder`, `currentChar`, `lastLoadedLoadoutName`, collection
   pointer clamps). Update settings only when that scalar changed.

4. Use `message-free` as the cheap floor. Most `hydrated` routes never touch
   `chat.message[]`, so the message load and `syncChatMessages` no-op can be
   removed safely. This is a stopgap because it still rewrites characters,
   collection tables, and settings.

---

## Prioritized findings

Priority = write amplification, call frequency, and fix clarity. Each entry
lists the current physical write and the target write, already corrected for the
normalization and settings co-write rules.

### Tier 1 — Pure settings/pointer writes that rewrite the entire DB (highest ratio, cleanest fix)

These change settings scalars but rewrite characters, chats, all 9 collection
tables, and often messages. Most narrow to one `UPDATE settings`.

- `PATCH /api/v1/commands/characters/reorder` — `commands.ts:2457` (helper `hydrated`).
  - Actual: load all messages + rewrite all characters + all 9 collection tables + settings.
  - Desired: `UPDATE settings` only. The sole write is `target.characterOrder = order`
    (`:2477`); `characterOrder`/`currentChar` are settings scalars. `reorder` edits the
    presentation order field, not the physical `characters` table positions, so no
    character row changes.
  - Fix: bespoke settings-only mutation (`writeSettingsOnly`). Verifier: confirmed.

- `PATCH /api/v1/commands/prompt-settings` — `commands.ts:1424` (`hydrated`).
  - Actual: as above.
  - Desired: `UPDATE settings` only. All 21 `PROMPT_SETTINGS_KEYS` written by
    `applySettingsPatch` are settings-row scalars. Verifier: confirmed.
  - Projection caveat: `prompt` resource maps to `['botPresets']` (wrong field — see
    Projection section); co-fix needed for foreign refresh, not for the write.

- `POST /api/v1/commands/plugins/provider` — `commands.ts:3966` (`hydrated`).
  - Desired: `UPDATE settings` only (`currentPluginProvider` scalar). Verifier: confirmed.

- `POST /api/v1/commands/modules/enable` — `commands.ts:3708` (`hydrated`).
  - Desired: `UPDATE settings` only (`enabledModules` is a settings scalar). Verifier:
    overstated→medium: the write narrows cleanly; the `module` projection stays broad
    (shared with `module.deleted`/`reordered`), so a narrow `moduleEnabled` resource is the
    matching projection-side fix.

- `PATCH /api/v1/commands/settings/:group` — `commands.ts:1074` (`message-free`).
  - Desired: `UPDATE settings` for 8 of 9 groups; for the `memory` group only, also a
    full `hypa_v3_presets` table rewrite iff the patch carries `hypaV3Presets`. Verifier:
    confirmed (rewriting every character row for a settings patch is the high-severity core).

- `POST /api/v1/commands/lorebooks/:lorebookId/select` — `commands.ts:3459` (`hydrated`).
  - Desired: `UPDATE settings` only (`loreBookPage` scalar) at the write level. Verifier:
    overstated→medium — this route currently also persists `ensureAllChildLorebooks`
    repairs across `characters`/`chats`/`modules`; narrowing must explicitly accept dropping
    that global normalization (prerequisite 2). Projection `lorebook` stays broad.

- `POST /api/v1/commands/translator-presets/select` — `commands.ts:2050` (`hydrated`).
  - Desired: `UPDATE settings` (`translatorPresetId`/`translatorPrompt`/`translatorMaxResponse`)
    + the `translator_presets` table (because `ensureTranslatorPresetCollection`
    reassigns the whole array). Verifier: overstated→medium — not settings-only; one
    collection table + settings.

### Tier 2 — Plugin custom storage (key-addressable, currently rewrites all characters + 9 collection tables)

- `PUT /api/v1/commands/plugin-storage/:key` — `commands.ts:4032` (`message-free`).
- `DELETE /api/v1/commands/plugin-storage/:key` — `commands.ts:4066` (`message-free`).
- `POST /api/v1/commands/plugin-storage/bulk` — `commands.ts:4099` (`message-free`).
  - Actual: rewrite all characters + all chats + all 9 collection tables + settings +
    `plugin_custom_storage`.
  - Desired: only `plugin_custom_storage` — single-key `UPSERT`/`DELETE` (PUT/DELETE),
    or a `DELETE`-all + reinsert for `bulk` (clear semantics). Note `pluginCustomStorage`
    is neither a settings key nor one of the 9 collection tables — it is its own standalone
    table written only at the tail of `replaceAllCollectionsInTable` (`repository.ts:167-176`),
    so it needs its own writer. Verifier: confirmed for all three. These are written by
    plugins at runtime, so the all-character rewrite is real recurring waste.
  - Projection: `pluginStorage` is intentionally full-bootstrap (sprawling); narrowing the
    write yields no projection change but is correct.

### Tier 3 — Single character-row / chat-row metadata edits

The change is one character row or one chat row; the foreign refresh reads SQLite fresh,
so narrowing the write never desyncs the projection (it only leaves the refresh broad —
see Projection section). Most are `hydrated` despite touching no messages.

Single character row (`UPDATE characters WHERE id=?`; folders/scripts/globalLore live
in the character `data_json`, which excludes only `chats`):

- `PATCH /api/v1/commands/characters/:characterId` — `commands.ts:2350`. Desired: one
  character row, + settings only when the patch sets `trashTime` (which re-runs
  `normalizeCharacterOrder`/`normalizeCurrentChar`). Verifier: overstated→high ("+settings
  on trash" correction).
- `PUT /api/v1/commands/characters/:characterId/lorebooks` — `commands.ts:3528`. Desired:
  one character row (`globalLore`, can be large). Verifier: confirmed, clean.
- `POST /api/v1/commands/characters/:characterId/chat-folders` — `commands.ts:2811`.
  Desired: one character row (`chatFolders` is inline on the character row). Confirmed.
- `PATCH /api/v1/commands/chat-folders/:folderId` — `commands.ts:2853`. Desired: one
  character row. Confirmed.
- `POST /api/v1/commands/characters/:characterId/chat-folders/reorder` — `commands.ts:2939`.
  Desired: one character row (`chatFolders` + optional `chatPage`). Confirmed.
- `DELETE /api/v1/commands/chat-folders/:folderId` — `commands.ts:2896`. Desired: one
  character row (`chatFolders`) + that character's chat rows whose `folderId` is nulled
  (`chat.folderId` lives in the `chats` table, not the character row). Verifier:
  overstated→high — the chat-row write is mandatory, so this spans two tables for one
  character.
- `POST /api/v1/commands/characters/:characterId/chats/reorder` — `commands.ts:2758`.
  Desired: that character's chat rows (positions shift) + its character row (`chatPage`); no
  messages (chat ids unchanged → `syncChatMessages` no-op). Confirmed.
- `POST /api/v1/commands/characters/:characterId/modules/reorder` — `commands.ts:3782`.
  Desired: one character row (`character.modules`) + `modules` table + `enabledModules`
  when `ensureModuleRecords`/`ensureEnabledModules` normalization actually mutates them.
  Verifier: overstated→high (the classifier's "modules is read-only" was wrong).
- `POST /api/v1/commands/chats/:chatId/fork` — `commands.ts:2655`. Desired: the source
  character's row (`chatPage`/`chatFolders`) + all of that character's chat rows (head
  `unshift` shifts positions) + the forked chat's new messages (already surgical). Verifier:
  overstated→medium — scoped to one character but not a single row; cross-character
  validation/normalization must stay validate-only.

Single chat row (`UPDATE chats WHERE id=?`):

- `PATCH /api/v1/commands/chats/:chatId/scriptstate` — `commands.ts:2983` (`hydrated`).
  Hot path (script/generation runtime). Desired: the patched chat row (`scriptstate` lives
  in `chats.data_json`); + its parent character row only if you keep the
  `normalizeAllCharacterChats` repairs. Verifier: overstated→high. The dominant win is
  dropping the all-message hydrate + the all-character/9-collection rewrite this incurs on
  every scriptstate write.
- `PATCH /api/v1/commands/chats/:chatId` — `commands.ts:2560` (`message-free`). Desired:
  one chat row, + the parent character row only when `select:true` (`chatPage` moves).
  Verifier: confirmed.
- `PUT /api/v1/commands/chats/:chatId/lorebooks` — `commands.ts:3564` (`hydrated`).
  Desired: one chat row (`localLore`). Verifier: overstated→high — needs a
  `writeSingleChatRow` helper (none exists) and a policy on the cross-character normalization.

### Tier 4 — Single collection-table edits (rewrite one of 9 tables, not all 9)

Each family edits one collection but rewrites all 9 collection tables and all
characters, plus messages when `hydrated`. Pure field edits can use
`UPDATE ... WHERE position=?`; create/delete/reorder rewrite that one table.
Pointer scalars ride along in settings when they change.

| Family → table | Routes (line) | Desired write |
| --- | --- | --- |
| Presets → `bot_presets` | create 1105, patch 1143, delete 1185, copy 1251, select 1299, import 1341, reorder 1379 | `bot_presets` table (+ settings `botPresetsId`). `select`/`delete` with `apply=true` additionally write the `prompt_templates` table (via `applyPreset` writing `promptTemplate`, a collection) + ~73 settings scalars — verifier flagged the classifier's range as too small for these two. |
| Prompt items → `prompt_templates` | create 1453, patch 1489, delete 1528, enable 1562, reorder 1601 | `prompt_templates` table only. Projection bug: `promptItem`/`prompt` map to `['botPresets']`, not `promptTemplate` (see Projection section). |
| Personas → `personas` | create 1637, patch 1682, delete 1732, select 1804, reorder 1850 | `personas` table (+ settings `selectedPersona`, and the 4 legacy mirror scalars `username`/`userIcon`/`personaPrompt`/`userNote` when `mirrorLegacyProfile` — these are not in the persona projection field set). |
| Translator presets → `translator_presets` | create 1895, patch 1936, delete 1984 | `translator_presets` table + settings (`translatorPresetId`/`translatorPrompt`/`translatorMaxResponse`). `ensureTranslatorPresetCollection` rewrites the whole array + syncs legacy fields on every call, so a full one-table rewrite + unconditional settings write (not a single-row UPDATE). |
| Loadouts → `loadouts` | create 2085, patch 2121, delete 2163, favorite 2197, touch 2232 | `loadouts` table + settings (`lastLoadedLoadoutName`, defaulted by `ensureLoadoutCollection`; `touch` writes it explicitly). `favorite`/`touch` are pure field edits but the repair pass rewrites the whole array → full one-table rewrite. |
| Lorebooks → `lore_books` | create 3306, patch 3343, delete 3378, reorder 3416, entries 3493 | `lore_books` table + settings (`loreBookPage`). `ensureAllChildLorebooks` also repairs `character.globalLore` / `chat.localLore` / `module.lorebook` in memory; create/reorder/entries currently persist those, so they are effectively `message-free-downgrade`-only unless you accept dropping child-lorebook normalization. `patch` (name edit) is the clean one: single-row `lore_books` UPDATE, no settings. |
| Modules → `modules` | patch 3638, reorder 3748, `:id/lorebooks` 4137, `:id/scripts` 4239, `:id/triggers` 4273 | `modules` table only (patch/lorebooks = single-row by position; reorder = full one-table rewrite). Audit-time note: `:id/scripts`/`:id/triggers` triggered `ensureAllScriptDefinitionCollections` repairs across all characters+modules. Phase 4 later implemented the accepted decision: rewrite only `modules` and drop character repairs to validate-only. |
| Plugins → `plugins` | create 3823, patch 3859, delete 3894, enable 3931, reorder 3998 | `plugins` table (+ settings `currentPluginProvider` for `delete`). `patch`/`enable` are clean single-row `UPDATE … WHERE position=?`; create/delete/reorder = full one-table rewrite. Projection already narrow (`['plugins','currentPluginProvider']`), so these are the lowest-risk Tier-4 fixes. Verifier: all confirmed. |

### Tier 5 — `message-free-downgrade` is the ceiling (deeper narrowing blocked)

For these routes, the cheap floor is also the safe ceiling. A per-row write is
blocked by a cross-table span, message dependency, or normalization dependency.
Use `message-free` where safe, or keep `hydrated` where noted.

- `DELETE /api/v1/commands/characters/:characterId` — `commands.ts:2390`. The
  `characters`/`chats` tables have no FK cascade to the message store; today the orphaned
  message/`hypa_v3` rows are cleaned only because `syncChatMessages` sees them vanish from the
  hydrated baseline. A naive narrowing would leak message rows permanently. Narrowing
  requires replacing the hydrate with a targeted `deleteChatMessages`/`deleteChatHypaV3` over
  the deleted character's chat ids. Verifier: medium, keep message handling.
- `DELETE /api/v1/commands/modules/:moduleId` — `commands.ts:3673`. `removeModuleReferences`
  strips the id from `enabledModules` (settings) + every `character.modules` + every
  `chat.modules` + every `loadout.modules` — spans characters, chats, two collection tables,
  and settings. No single-table lever applies; `message-free-downgrade` only. Verifier: medium.
- `POST /api/v1/commands/characters/:characterId/chats` — `commands.ts:2495`. The duplicate
  message-id validation (`messageIdExists`) scans every chat's `message[]` corpus-wide, so the
  message load is a real validation dependency; `unshift` + multi-character normalization rewrite
  multiple character/chat rows. Drop only the 9-collection + settings rewrite. Verifier: low.
- `DELETE /api/v1/commands/chats/:chatId` — `commands.ts:2617`. Reduces to the owning
  character's row (`chatPage`) + that character's chat rows + a targeted message delete; safe as
  a scoped narrowing but not a single row. Verifier: high.
- `POST /api/v1/commands/characters` (2273) and `/create-and-select` (2310). Append one
  character row, + settings (`characterOrder` always appended, `currentChar` clamped). Feasible
  as a single `INSERT` + settings, but with the caveat that existing-row id-repair side effects are
  dropped. Start with `message-free-downgrade`.
- `POST /api/v1/commands/modules` (3602). Appends one module row, but
  `ensureModuleCommandDatabase` can also repair existing module ids,
  `enabledModules`, and character collection shape. Start with
  `message-free-downgrade` until those repairs are scoped to validate-only or
  explicitly co-written.
- `PUT /api/v1/commands/characters/:characterId/scripts` (4171) and `/triggers` (4205).
  `normalizeScriptDefinitionDatabase` + `ensureCharacterCollection` rewrite all characters +
  all modules + settings (`characterOrder`/`currentChar`) on every call. A single-character-row
  write would silently drop those repairs and there is no helper for it. Verifier downgraded both
  from the optimistic `single-character-row` claim: the only faithful near-term fix is
  `message-free-downgrade` (medium/low). The full single-row fix needs the normalization to be
  scoped first.

---

## Projection-range mismatches (read/refresh side)

`RESOURCE_PROJECTION_FIELDS` (`routes/projection.ts:34`) maps each event resource
to the fields a foreign/recovery refresh ships. These refreshes are rare, but a
narrowed write with a broad projection still refreshes too much. The reference
fix narrowed both the write and projection.

Broad resources worth splitting when their matching write is narrowed:

- `character → ['characters','characterOrder','currentChar']` — every character event
  (create/update/reorder/modules-reorder) re-ships the whole stubbed `characters` array. No
  per-character narrow branch exists (only `characterSelection`/`characterLorebook`).
- `chat`, `chatFolder`, `message`, `generation → ['characters']` — every chat/folder/message
  change re-ships the entire stubbed `characters` array. `generation.persisted` is the one
  that actually fires foreign (server-owned post-generation), so it is the most worth a narrow
  per-chat branch.
- `lorebook → ['characters','modules','loreBook','loreBookPage']` — the broadest; shared by
  global-lorebook commands and the character/chat/module `globalLore`/`localLore`/`lorebook`
  entry-replace commands, so it cannot be retargeted without splitting the resource
  (e.g. a `globalLorebook` resource shipping only `['loreBook','loreBookPage']`).
- `module → ['modules','enabledModules','loadouts','characters']` — shared across module
  create/update/delete/enable/reorder; correct only for `delete`. `module.enabled`/`reordered`/
  `updated` would each want a narrower resource.
- `scriptDefinition` / `triggerDefinition → ['characters','modules']` — re-ship whole
  characters + modules for a one-row script/trigger edit.

Pre-existing projection-field bugs. These ship the wrong field today, independent
of write range:

- `prompt → ['botPresets']` and `promptItem → ['botPresets']` (`projection.ts:45-46`) — but
  `prompt-settings` writes 21 settings scalars and the prompt-item commands write
  `promptTemplate`. A foreign refresh ships `botPresets` and never reflects the changed
  fields. Fix: `prompt` should fall back to full/sprawling (its keys are scattered settings
  scalars); `promptItem` should map to `['promptTemplate']`.
- `persona → ['personas','selectedPersona']` omits the legacy mirror scalars
  (`username`/`userIcon`/`personaPrompt`/`userNote`) that `select`/`delete` write via
  `mirrorLegacyProfile`. Add them (they read straight off the settings row).
- `loadout → ['loadouts']` omits `lastLoadedLoadoutName`, which `touch`/`delete` write. Add it.

Intentionally full-bootstrap (no narrowing possible, and correct): `settings`, `state`,
`pluginStorage` (sprawling). Narrowing their mutations is still correct, just yields no
projection win.

---

## Suggested implementation order

1. Mechanical floor: swap safe `hydrated` non-message routes to
   `applyMessageFreeJsonCommandMutation`. Skip 2390, 2495, 2617, 2655, and the
   message commands.
2. Build the writer kit and add `commandMetrics.test.ts` review gates for each
   new `mutationPath`.
3. Narrow Tier 1 and Tier 2: settings-only and plugin-storage routes.
4. Narrow Tier 3 character/chat row routes and add matching projection branches.
5. Narrow Tier 4 collection families, plugins first, with pointer co-writes and
   projection-field fixes.
6. Leave Tier 5 at the `message-free` floor until blockers are scoped.

For every targeted path: normalize the target row, treat global de-dup as
validate-only, and add a regression test proving unrelated rows are not
rewritten. Use `tableRowidsById` in
`server/fastify/__tests__/commands.test.ts` as the template.

---

## Appendix — full route table

`adj` = severity after adversarial verification. `lever` = recommended narrowing (see
prerequisites for why some "single-X" levers reduce to `message-free-downgrade`).

| Line | Route | Helper | adj | Lever |
| --- | --- | --- | --- | --- |
| 1047 | `POST /api/v1/commands/state/initialize` | other | none | already-targeted |
| 1074 | `PATCH /api/v1/commands/settings/:group` | message-free | high | settings-only |
| 1105 | `POST /api/v1/commands/presets` | hydrated | high | single-collection-table |
| 1143 | `PATCH /api/v1/commands/presets/:presetId` | hydrated | high | single-collection-table |
| 1185 | `DELETE /api/v1/commands/presets/:presetId` | hydrated | high | single-collection-table |
| 1251 | `POST /api/v1/commands/presets/:presetId/copy` | hydrated | high | single-collection-table |
| 1299 | `POST /api/v1/commands/presets/select` | hydrated | high | single-collection-table |
| 1341 | `POST /api/v1/commands/presets/import` | hydrated | medium | single-collection-table |
| 1379 | `POST /api/v1/commands/presets/reorder` | hydrated | high | single-collection-table |
| 1424 | `PATCH /api/v1/commands/prompt-settings` | hydrated | high | settings-only |
| 1453 | `POST /api/v1/commands/prompt-items` | hydrated | high | single-collection-table |
| 1489 | `PATCH /api/v1/commands/prompt-items/:itemId` | hydrated | high | single-collection-table |
| 1528 | `DELETE /api/v1/commands/prompt-items/:itemId` | hydrated | high | single-collection-table |
| 1562 | `POST /api/v1/commands/prompt-items/enable` | hydrated | high | single-collection-table |
| 1601 | `POST /api/v1/commands/prompt-items/reorder` | hydrated | high | single-collection-table |
| 1637 | `POST /api/v1/commands/personas` | hydrated | high | message-free-downgrade |
| 1682 | `PATCH /api/v1/commands/personas/:personaId` | hydrated | medium | single-collection-table |
| 1732 | `DELETE /api/v1/commands/personas/:personaId` | hydrated | medium | single-collection-table |
| 1804 | `POST /api/v1/commands/personas/select` | hydrated | medium | single-collection-table |
| 1850 | `POST /api/v1/commands/personas/reorder` | hydrated | high | single-collection-table |
| 1895 | `POST /api/v1/commands/translator-presets` | hydrated | high | single-collection-table |
| 1936 | `PATCH /api/v1/commands/translator-presets/:presetId` | hydrated | high | single-collection-table |
| 1984 | `DELETE /api/v1/commands/translator-presets/:presetId` | hydrated | high | single-collection-table |
| 2050 | `POST /api/v1/commands/translator-presets/select` | hydrated | medium | settings-only |
| 2085 | `POST /api/v1/commands/loadouts` | hydrated | high | single-collection-table |
| 2121 | `PATCH /api/v1/commands/loadouts/:loadoutId` | hydrated | high | single-collection-table |
| 2163 | `DELETE /api/v1/commands/loadouts/:loadoutId` | hydrated | high | single-collection-table |
| 2197 | `POST /api/v1/commands/loadouts/:loadoutId/favorite` | hydrated | medium | single-collection-table |
| 2232 | `POST /api/v1/commands/loadouts/:loadoutId/touch` | hydrated | high | single-collection-table |
| 2273 | `POST /api/v1/commands/characters` | hydrated | high | message-free-downgrade |
| 2310 | `POST /api/v1/commands/characters/create-and-select` | hydrated | medium | message-free-downgrade |
| 2350 | `PATCH /api/v1/commands/characters/:characterId` | hydrated | high | single-character-row |
| 2390 | `DELETE /api/v1/commands/characters/:characterId` | hydrated | medium | message-free-downgrade |
| 2431 | `POST /api/v1/commands/characters/select` | character-selection | none | already-targeted |
| 2457 | `POST /api/v1/commands/characters/reorder` | hydrated | high | settings-only |
| 2495 | `POST /api/v1/commands/characters/:characterId/chats` | hydrated | low | message-free-downgrade |
| 2560 | `PATCH /api/v1/commands/chats/:chatId` | message-free | medium | single-chat-row |
| 2617 | `DELETE /api/v1/commands/chats/:chatId` | hydrated | high | message-free-downgrade |
| 2655 | `POST /api/v1/commands/chats/:chatId/fork` | hydrated | medium | single-character-row |
| 2758 | `POST /api/v1/commands/characters/:characterId/chats/reorder` | hydrated | high | single-character-row |
| 2811 | `POST /api/v1/commands/characters/:characterId/chat-folders` | hydrated | high | single-character-row |
| 2853 | `PATCH /api/v1/commands/chat-folders/:folderId` | hydrated | high | single-character-row |
| 2896 | `DELETE /api/v1/commands/chat-folders/:folderId` | hydrated | high | single-character-row |
| 2939 | `POST /api/v1/commands/characters/:characterId/chat-folders/reorder` | hydrated | high | single-character-row |
| 2983 | `PATCH /api/v1/commands/chats/:chatId/scriptstate` | hydrated | high | single-chat-row |
| 3030 | `POST /api/v1/commands/chats/:chatId/messages` | targeted | none | already-targeted |
| 3072 | `PATCH /api/v1/commands/messages/:messageId` | targeted | none | already-targeted |
| 3118 | `DELETE /api/v1/commands/messages/:messageId` | targeted | none | already-targeted |
| 3163 | `POST /api/v1/commands/chats/:chatId/messages/truncate` | targeted | none | already-targeted |
| 3207 | `PUT /api/v1/commands/chats/:chatId/messages` | targeted | none | already-targeted |
| 3248 | `POST /api/v1/commands/chats/:chatId/generation-result` | targeted | none | already-targeted |
| 3306 | `POST /api/v1/commands/lorebooks` | hydrated | medium | single-collection-table |
| 3343 | `PATCH /api/v1/commands/lorebooks/:lorebookId` | hydrated | high | single-collection-table |
| 3378 | `DELETE /api/v1/commands/lorebooks/:lorebookId` | hydrated | high | single-collection-table |
| 3416 | `POST /api/v1/commands/lorebooks/reorder` | hydrated | low | single-collection-table |
| 3459 | `POST /api/v1/commands/lorebooks/:lorebookId/select` | hydrated | medium | settings-only |
| 3493 | `PUT /api/v1/commands/lorebooks/:lorebookId/entries` | hydrated | high | single-collection-table |
| 3528 | `PUT /api/v1/commands/characters/:characterId/lorebooks` | hydrated | high | single-character-row |
| 3564 | `PUT /api/v1/commands/chats/:chatId/lorebooks` | hydrated | high | single-chat-row |
| 3602 | `POST /api/v1/commands/modules` | hydrated | high | message-free-downgrade |
| 3638 | `PATCH /api/v1/commands/modules/:moduleId` | hydrated | high | single-collection-table |
| 3673 | `DELETE /api/v1/commands/modules/:moduleId` | hydrated | medium | message-free-downgrade |
| 3708 | `POST /api/v1/commands/modules/enable` | hydrated | medium | settings-only |
| 3748 | `POST /api/v1/commands/modules/reorder` | hydrated | high | single-collection-table |
| 3782 | `POST /api/v1/commands/characters/:characterId/modules/reorder` | hydrated | high | single-character-row |
| 3823 | `POST /api/v1/commands/plugins` | hydrated | high | single-collection-table |
| 3859 | `PATCH /api/v1/commands/plugins/:pluginId` | hydrated | high | single-collection-table |
| 3894 | `DELETE /api/v1/commands/plugins/:pluginId` | hydrated | high | single-collection-table |
| 3931 | `POST /api/v1/commands/plugins/:pluginId/enable` | hydrated | high | single-collection-table |
| 3966 | `POST /api/v1/commands/plugins/provider` | hydrated | high | settings-only |
| 3998 | `POST /api/v1/commands/plugins/reorder` | hydrated | high | single-collection-table |
| 4032 | `PUT /api/v1/commands/plugin-storage/:key` | message-free | medium | settings-only |
| 4066 | `DELETE /api/v1/commands/plugin-storage/:key` | message-free | high | settings-only |
| 4099 | `POST /api/v1/commands/plugin-storage/bulk` | message-free | medium | settings-only |
| 4137 | `PUT /api/v1/commands/modules/:moduleId/lorebooks` | hydrated | high | single-collection-table |
| 4171 | `PUT /api/v1/commands/characters/:characterId/scripts` | hydrated | medium | single-character-row |
| 4205 | `PUT /api/v1/commands/characters/:characterId/triggers` | hydrated | low | single-character-row |
| 4239 | `PUT /api/v1/commands/modules/:moduleId/scripts` | hydrated | high | single-collection-table |
| 4273 | `PUT /api/v1/commands/modules/:moduleId/triggers` | hydrated | medium | single-collection-table |
