# Open Findings

Date: 2026-05-28

These are the unresolved server-projection violations confirmed by parallel
sub-agent audits against the current codebase, with precision corrections folded
in from [`audit.md`](./audit.md). Each maps to an exit criterion in
[`README.md`](./README.md), a work bucket in
[`closeout-buckets.md`](./closeout-buckets.md), and a recorded decision in
[`decisions.md`](./decisions.md). Do not declare client thinning complete until
all of these are closed with regression coverage.

Each finding states the **problem** as it exists in the code today; the chosen
**direction** is summarized in the Decision line and detailed in
[`decisions.md`](./decisions.md) / [`closeout-buckets.md`](./closeout-buckets.md).

## F3 → EC3 (P1): JSON import can persist non-current-shape DB data

Multipart `.risu` import runs the broad current-shape normalizer, but JSON
`{ database }` import runs a narrower route-local normalizer.

- `server/fastify/src/routes/save.ts:68-70` accepts `body.database`, runs only the route-local normalizer, and applies that database.
- `server/fastify/src/routes/save.ts:185-215` normalizes presets, translator presets, loadouts, prompt templates, and script definitions only.
- `server/fastify/src/risuSave/importSnapshot.ts:155` is the broader normalizer (messages, personas, modules, plugins, plugin storage, global/child lorebooks, scripts).
- `server/fastify/src/repository.ts:107-117` persists any non-null/undefined database payload.
- `server/fastify/src/routes/bootstrap.ts:20-24` loads persisted data and masks secrets, but does not run current-shape normalization.

Precision (from audit):

- JSON import persists a **route-normalized inbound payload**, not a completely
  untouched one; and bootstrap serves **without shape repair** (secrets are still
  masked). The JSON route also accepts broad non-object payloads unless the
  narrow route-local normalizer happens to throw.
- The broad normalizer is **already exported** as
  `normalizeRisuSaveImportDatabase` (`importSnapshot.ts:83`).

**Decision (EC3=A):** call the already-exported `normalizeRisuSaveImportDatabase`
from the JSON path before `applyImportedDatabase`; audit malformed-seed tests.
See [`decisions.md`](./decisions.md#ec3).

## F4 → EC4 (P1/P2): Public command paths still repair stable ids / bypass resource semantics

Several public replacement helpers still repair durable child ids, and prompt
items are still reachable through a settings command.

- Lorebook entry replacement repairs ids: `ensureLorebookEntries` generates missing and replaces duplicate ids around `server/fastify/src/commands/lorebooks.ts:218`, `:226`, `:280`; public routes at `server/fastify/src/routes/commands.ts:3272`, `:3309`, `:3343`, `:3916`.
- Script/trigger replacement repairs ids: `ensureDefinitionRecords` around `server/fastify/src/commands/scriptDefinitions.ts:97`, `:104`, `:127`; public routes at `server/fastify/src/routes/commands.ts:3950`, `:3984`, `:4018`, `:4052`.
- Message `createMessageRecord` still generates a missing `chatId` around `server/fastify/src/commands/messages.ts:68`; `ensureChatMessages` repairs existing malformed DB state around `:50`.
- `promptTemplate` is accepted as a raw `array|null` through the dedicated prompt-settings command: `server/fastify/src/commands/prompts.ts:11`, `:177`, applied at `server/fastify/src/routes/commands.ts:1328`, `:1341`, emitting `prompt.settings.updated` (`events.ts:53`).
- Prompt-item **create** still mints ids server-side at `server/fastify/src/commands/prompts.ts:64`.

Precision (from audit) — partly stale:

- **Message duplicate ids are already rejected** by `validateUniqueMessageIds`
  (`messages.ts:97`, `:158`; tests `commands.test.ts:3134`). Only the _missing_
  `chatId` generation remains.
- **Prompt-item CRUD/reorder already exists** with resource-specific events
  (`commands.ts:1357`, `:1393`, `:1432`, `:1466`; tests `commands.test.ts:1322`),
  and the UI already uses it. The bypass is specifically the
  `/commands/prompt-settings` route (the generic `/commands/settings/:group`
  already rejects the `prompt` group). The one known raw client use is the
  enable/disable toggle patching `{ promptTemplate: [] }` at
  `src/lib/Setting/Pages/BotSettings.svelte:1455`.

**Decision (EC4):** **4a** split each id helper into `repairX` (import, may mint
ids) + `validateX` (command, rejects missing/dup) — messages need only to stop
generating the missing `chatId`; lorebook entries and script/trigger defs get the
full split. Create commands (incl. prompt-item create, `prompts.ts:64`) require a
client-supplied id — minting lives only in import/bootstrap. **4b** subtractive: drop `promptTemplate` from `/commands/prompt-settings`
and route the `BotSettings` toggle through a command; the `/prompt-items/*`
commands are the only editing path. See [`decisions.md`](./decisions.md#ec4).

## F5 → EC5 (P2): Higher-level command wrappers hide 409 conflicts by replaying stale payloads

On a first 409, the high-level browser wrappers resend the same stale payload
with the newer revision (last-writer-wins).

- `src/ts/server/commands.ts:2145` reads a base revision, `:2151` sends the command, and `:2152` retries the same `input.command` with `result.currentRevision` after a conflict.
- **Second retry site:** `patchServerBackedSettings` has its own blind retry at `src/ts/server/commands.ts:1038`, replaying the same patch with `result.currentRevision`.
- The retry is **one-shot** (a second 409 can roll back), but the first conflict is already hidden.
- The low-level transport already surfaces conflicts as `{ status: "conflict", currentRevision }` at `src/ts/server/commands.ts:2204`; direct typed helpers can return visible conflicts (coverage `commands.test.ts:313`).
- The server correctly rejects stale revisions (`server/fastify/src/commands/mutations.ts:50`) and maps to 409 (`server/fastify/src/routes/commands.ts:4194`; coverage `commands.test.ts:190`).
- Browser tests still encode replay for several families: settings `src/ts/server/commands.test.ts:486`, presets `:646`, prompts `:821`.
- Other mutating routes do **not** take a `baseRevision`: import (`save.ts:48`) and asset upload (`assets.ts:35`); backups (`backups.ts:25`, `:46`, `:62`) and legacy storage writes (`legacyStorage.ts:67`, `:88`) are also mutating endpoints. The active-writer guard must cover them ([`decisions.md`](./decisions.md#ec5)).

Precision (from audit): conflict-hiding is **not** limited to `runServerCommand`;
callers are widespread (settings bridge `settingsBridge.svelte.ts:114`, presets
`database.svelte.ts:99`, plugin/module/chat wrappers `pluginCommands.ts:59`,
`moduleCommands.ts:50`, `chatCommands.ts:85`).

**Decision (EC5=session single-writer lock):** prevent the conflict instead of
resolving it — only the most recently bootstrapped session may mutate; stale
sessions get **423** → notify + reload. Still remove the blind 409 replay at both
sites as a backstop. This drops the conflict-resolution page and the retry-safety
classification. See [`decisions.md`](./decisions.md#ec5).

## F6 → EC6 (P2): Asset reference validation is incomplete for character audio refs

The asset-reference walker treats character audio fields as server asset
references, but character validation does not cover them.

- `server/fastify/src/risuSave/assetReferences.ts:85` walks character asset references; `:93` includes `vits.files` (dynamic refs at `:122`); `:95` plus `:141-143` include the GPT-SoVITS reference-audio asset.
- `server/fastify/src/commands/characters.ts:371` (`validateCharacterAssetRefs`) validates `image`, `emotionImages`, `additionalAssets`, `ccAssets`, and `prebuiltAssetExclude` only.
- Both create and patch are affected: create validates through `createCharacterRecord(... assetDataDir ...)` at `server/fastify/src/routes/commands.ts:2144`; patch through `readCharacterPatch(... assetDataDir ...)` at `:2182`.

Precision (from audit):

- The server asset field is **`gptSoVitsConfig.ref_audio_data.assetId`**, not
  `ref_audio_path`.
- `vits.files` is a **dynamic object map**; validation should iterate values and
  report `character.vits.files.<key>` / `patch.vits.files.<key>`.
- Asset ids are SHA-256 hex (`server/fastify/src/repository.ts:29`); syntactically
  valid but missing ids should still be rejected by `assetById`. The UI writes the
  field from `saveAsset(audio.data)` at `src/lib/SideBars/CharConfig.svelte:1372`.
- The optional asset-ref validator intentionally allows `undefined`/`null`/`""`/`"-"`
  (`server/fastify/src/commands/assets.ts:7`, `:20`), so "missing" means a
  syntactically valid SHA-256 id **absent from persisted assets**, not an
  empty/clear value.
- EC6 stays scoped to character **audio** refs. The broader walker-vs-validator
  drift class — e.g. `characterOrder.img` walked at `assetReferences.ts:69` while
  order validation checks `imgFile` (`characters.ts:215`) — is caught by EC7's
  audit, not this bucket ([`decisions.md`](./decisions.md#ec6)).

**Decision (EC6):** extend `validateCharacterAssetRefs` to `vits.files.*` and
`gptSoVitsConfig.ref_audio_data.assetId`, reusing the existing optional-asset-ref
validators (covers create + patch); reject-on-missing; tests for valid/missing/
malformed on both. See [`decisions.md`](./decisions.md#ec6).

## Audit notes and exclusions

- Runtime-local caches (MCP display cache, translation/model caches, embedding
  caches, inlay assets, plugin permission prompts) are explicitly allowed by
  [`../phases-completed/phase-9-client-thinning-9-6d.md`](../phases-completed/phase-9-client-thinning-9-6d.md).
  They are not completion failures unless they become authoritative DB state.
- Remaining `bind:chara={DBState.db.characters[...]}` sites were checked; the
  inspected chat/toggle mutations route through command helpers in Fastify mode,
  so those bindings are not blockers.
