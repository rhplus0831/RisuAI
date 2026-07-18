# Character TTS sibling edit destroys the stored OpenAI API key with the mask sentinel

## Summary

Character reads mask the per-character OpenAI TTS API key with
`__RISU_SECRET_MASKED__`. The character editor diffs drafts at top-level
granularity, so editing any sibling field of `oaiTTSConfig` (model, base URL,
response format, voice, or the advanced-endpoint toggle) ships the whole
object — masked `apiKey` included — in the character PATCH. Unlike the settings
and legacy-preset write paths, the character PATCH route never resolves masked
placeholders against the stored row, so the server persists the literal
sentinel as the key. The real credential is permanently destroyed with no
error, invisibly (the next read re-masks), until TTS fails.

## Location

- `src/lib/SideBars/CharConfig.svelte:1957-2012` — OpenAI TTS section:
  `oaiTTSConfig.voice/baseURL/model/format/enabled` binds beside the
  `SecretInput` apiKey (:1985-1991).
- `server/fastify/src/routes/resourceReads.ts:282,298,362` — all character
  reads run `maskProviderSecretsInPlace`.
- `src/ts/providerSecretMask.ts:18` —
  `['characters', *, 'oaiTTSConfig', 'apiKey']` is a registered secret path
  (sentinel `__RISU_SECRET_MASKED__`).
- `src/ts/server/characterBridge.svelte.ts:194-227` — draft dispatch: any
  change inside `oaiTTSConfig` marks the whole top-level object changed and
  copies it (mask included) into the projection; :294-363 + :437-448 — the
  profile watcher queues `PATCH /characters/:id` with `patch.oaiTTSConfig`
  verbatim.
- `src/ts/characterCommands.ts:164-176,2351-2358` —
  `CHARACTER_PATCH_EXCLUDED_KEYS` does not exclude `oaiTTSConfig`, and
  `sanitizeCharacterPatch` drops only excluded/undefined keys — the mask string
  passes through.
- `server/fastify/src/routes/commands.ts:5198-5254` — the character PATCH
  route: `readCharacterPatch` → `buildPatchedCharacterCollectionRow` with
  **no** `resolveMaskedProviderSecretPlaceholders` call (grep confirms the
  resolver is used only at :702 legacy presets, :2230 and :9183 settings).
- `server/fastify/src/commands/characters.ts` —
  `buildPatchedCharacterCollectionRow` spreads the patch over the row verbatim.
- `server/fastify/src/tts.ts:377-401` — synthesis uses the stored
  `character.oaiTTSConfig.apiKey` verbatim; `src/ts/process/tts.ts:402-434` —
  the client sees the mask and selects `source: 'stored-character'`, relying on
  the now-destroyed stored key.

## Trigger

A character has OpenAI TTS with the advanced endpoint and a saved per-character
API key. Reload the app (or any character read), so the editor draft holds the
masked placeholder. In CharConfig → TTS, edit any sibling field — Model, Base
URL, Response Format, Voice — or toggle the advanced-endpoint checkbox.

## Expected behavior

The sibling field persists; the stored API key is untouched (settings-group
secrets behave this way — their write path resolves placeholders back to the
stored value).

## Actual behavior

The debounced character PATCH ships the whole `oaiTTSConfig` including
`apiKey: "__RISU_SECRET_MASKED__"`; the server stores the sentinel string as
the key. TTS then fails (the server sends the literal sentinel as the bearer
key), and character exports contain the sentinel. The loss is invisible in the
UI because the next read re-masks whatever is stored.

## Underlying cause

Reads mask `characters.*.oaiTTSConfig.apiKey`, but the character PATCH route
never resolves masked placeholders against the existing row, while
nested-object edits are diffed only at top-level granularity on the client, so
the placeholder rides along on every sibling edit.

## Affected data flow

1. **UI:** TTS field edit → `characterDraft` deep bind.
2. **Client:** draft dispatch marks the whole `oaiTTSConfig` changed (mask
   included) → trusted projection write → profile watcher diff.
3. **Request:** durable outbox `PATCH /api/v1/commands/characters/:id`.
4. **Server:** `buildPatchedCharacterCollectionRow` spreads the patch;
   `writeSingleCharacterRow` persists the sentinel.
5. **Displayed state:** next read re-masks — UI looks identical while the real
   key is gone; TTS breaks later.

## Severity and likely user impact

**High.** Silent, permanent destruction of a stored credential from a routine
unrelated edit; the UI reports nothing wrong until TTS fails, and the cause is
undiscoverable from the UI.

## Recommended fix

In the character PATCH handler, resolve placeholders before building the row —
if `patch.oaiTTSConfig?.apiKey === MASKED_PROVIDER_SECRET`, substitute the
existing row's stored key (reuse `resolveMaskedProviderSecretPlaceholders`
with the existing row as source), or reject patches containing the sentinel.
Apply the same treatment to any future character-row secret paths.

## Test gap

Server route test: seed a character with a real `oaiTTSConfig.apiKey`, PATCH a
sibling field with `apiKey` set to the mask sentinel, and assert the stored key
is preserved (and never the sentinel).
