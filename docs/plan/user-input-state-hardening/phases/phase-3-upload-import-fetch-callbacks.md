# Phase 3: Upload, Import & Fetch Callbacks

Status: active.

Goal: guard long-running file, upload, image decode, import, and remote-fetch
callbacks so late results do not mutate a newer draft or different target.

## Scope

- Add request tokens and target checks around composer paste/menu file actions.
- Guard character avatar, emotion, additional asset, reference audio, and model
  registration callbacks.
- Guard settings media buttons, prompt preset icon upload, custom background,
  custom color scheme import, and additional params import.
- Guard module asset upload, plugin import/update, persona import, preset
  import, chat/character import helpers, and NanoGPT dashboard fetch
  persistence.
- Prefer helpers that return parsed/uploaded results and leave mutation to the
  still-current caller.

First landed slice: custom background upload/cancel/error callbacks now use a
latest-operation token and live placeholder check before async picker/upload
completion can apply, restore, or alert.

Second landed slice: composer paste/menu file callbacks now use a latest
operation token, active transcript identity, and composer mutation version before
async file results can append composer text or inlay asset ids.

Third landed slice: character avatar upload callbacks now use a latest operation
token issued only after a real file selection, target character id checks, and an
avatar snapshot check before async file results can apply image, `ccAssets`, PNG
metadata, or dispatch updates.

Fourth landed slice: character additional asset upload callbacks now use a
latest operation token issued only after selected files exist, target character
id checks, and an additional asset list snapshot before editor or chat quick-add
uploads can append entries to live state.

Fifth landed slice: module asset upload callbacks now use a latest operation
token issued only after selected files exist, target module id checks, and a
module asset list snapshot before the module asset editor can append entries to
live draft state.

Sixth landed slice: prompt preset icon upload callbacks now use a latest
operation token issued only after a selected file exists, target preset id
checks, selected-row checks, and an image snapshot before decoded icon data can
update a prompt preset.

Seventh landed slice: NanoGPT dashboard fetch callbacks now use a fixed latest
operation target plus captured API key checks before subscription-state fetch
results can persist `nanogptSubscriptionState`.

Eighth landed slice: character emotion image upload callbacks now use a latest
operation token issued only after selected files exist, target character id and
row checks, and an emotion image list snapshot before uploaded emotions can
append to a character or dispatch updates.

Ninth landed slice: settings media asset upload callbacks in `OtherBotSettings`
now use latest operation tokens issued only after selected files exist,
target/context/field snapshots, and freshness checks around `saveAsset` before
NovelAI character reference, NovelAI i2i base, or WaveSpeed reference images can
write image/base64 settings fields.

Tenth landed slice: character TTS media callbacks now use latest operation
tokens issued only after selected files exist, selected row/draft/`ttsMode`
checks, and VITS/ref-audio field snapshots before VITS model registration or
GPT-SoVITS reference audio upload can apply media fields.

Eleventh landed slice: custom color scheme import callbacks now use latest
operation tokens issued only after a real JSON file is selected, captured theme
name/scheme snapshots, and fresh validation before valid imports can apply or
invalid imports can alert.

Twelfth landed slice: plugin import/update callbacks now use latest operation
tokens and plugin-list snapshots across remote update fetch/text, file
picker/read, TypeScript transpile, safety modal, duplicate confirm, and final
create/update application so stale imports cannot alert or write.

Thirteenth landed slice: persona icon upload callbacks now use latest operation
tokens issued only after a real PNG is selected, selected-persona/icon snapshots,
and fresh selected-row resolution before image upload completion can apply icon
fields.

## Anchors

- `src/lib/ChatScreens/DefaultChatScreen.svelte`
- `src/ts/process/files/`
- `src/ts/globalApi.svelte.ts`
- `src/ts/server/assets.ts`
- `src/ts/characters.ts`
- `src/lib/SideBars/CharConfig.svelte`
- `src/lib/Setting/Pages/`
- `src/lib/UI/NanoGPTDashboard.svelte`
- `src/ts/process/modules.ts`
- `src/ts/plugins/`

## Target Shape

- A selected file can finish reading or uploading after navigation without
  changing the new active chat, character, preset, module, or setting.
- Upload completion re-resolves entity ids and draft versions before applying.
- Cancel/restore paths for custom background and similar controls do not
  restore an old value over a newer user choice.
- Remote fetches that persist state, such as dashboard subscription state,
  verify the API key/provider state they were fetched for.

## Exit Criteria

- Focused tests cover stale upload completion for composer, character avatar,
  character additional asset, settings media asset, module asset, prompt icon,
  and custom background/theme import.
- Import/fetch tests cover selection change while the file or request is in
  flight.
- Any accepted destructive import remains explicitly marked and tested as
  destructive.

## Validation

```bash
pnpm exec vitest run src/ts/process/files/multisend.test.ts
pnpm exec vitest run src/ts/characters.importChat.test.ts \
  src/ts/characterCards.pngImport.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Add nearest focused tests for settings, module, plugin, and dashboard callbacks
as those paths are changed.

## Risks

- File pickers and image decoders often resume in component code rather than
  shared helpers. The caller, not the upload helper alone, must own the final
  current-target check.
- Multiple-file loops need a run token for the whole loop plus per-file target
  checks before each append.
