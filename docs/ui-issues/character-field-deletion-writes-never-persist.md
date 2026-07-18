# Character field deletions expressed as `undefined` never persist

## Summary

The character patch pipeline has no way to express field deletion. Editors that
clear a character field by assigning `undefined` produce a patch that
`sanitizeCharacterPatch` silently empties, so nothing is dispatched: the UI
shows the cleared state, the server keeps the old value, and behavior driven by
the field (lorebook scan settings) continues unchanged. In one variant the
draft's dirty-field marker is also pinned forever, masking later external
updates to that field. Modules solved exactly this with a `null` delete
sentinel; characters never adopted it.

## Location

Shared root cause:

- `src/ts/characterCommands.ts:2351-2358` — `sanitizeCharacterPatch` drops
  `undefined`-valued keys; there is no `CHARACTER_PATCH_DELETABLE_KEYS`
  (contrast `MODULE_PATCH_DELETABLE_KEYS`, `src/ts/moduleCommands.ts:106-114`).
- `server/fastify/src/routes/commands.ts:5198-5254` — the character PATCH is
  merge-only; no key-delete mechanism.
- Upstream comparison: the original app persisted `undefined` naturally via
  whole-DB saves (`/home/codex/Risuai/src/lib/SideBars/CharConfig.svelte:552-556`,
  `LoreBookSetting.svelte:83`).

Trigger A — lorebook "use global settings":

- `src/lib/SideBars/LoreBook/LoreBookSetting.svelte:220-228` — the checkbox
  handler sets `characterLoreSettingsDraft.value.loreSettings = undefined`.
- `src/ts/server/characterBridge.svelte.ts:194-227` — draft dispatch sanitizes
  the patch to `{}`; the projection is never modified, so the profile watcher
  (:294-356) sees no diff and no PATCH is queued.
- Behavioral consumer: `src/ts/process/lorebook.svelte.ts:313-317` —
  `char.loreSettings?.scanDepth ?? getDatabase().loreBookDepth`.

Trigger B — inlay view screen toggle:

- `src/lib/SideBars/CharConfig.svelte:1592-1605` — unchecking "inlay view
  screen" with an empty asset list sets
  `characterDraft.value.additionalAssets = undefined`.
- `src/ts/server/characterBridge.svelte.ts:206-227` — change detection uses
  `'__undefined__'` snapshots, so `additionalAssets` is marked dirty while the
  outgoing patch loses the key; :179-192 — the dirty acknowledgement requires
  the key to appear in a dispatched patch, which never happens; :155-176 —
  `mergeProjectionIntoDirtyDraft` skips dirty keys on every future server
  apply.

## Trigger

- A: Character sidebar → LoreBook → Settings tab, with per-character lore
  settings active; check "use global settings". Compound case: uncheck then
  immediately re-check within the 300 ms watcher debounce — the enable PATCH
  still fires, persisting custom settings the user believes they cancelled.
- B: character with `viewScreen: emotion` and empty additional assets; uncheck
  "inlay view screen" in the editor.

## Expected behavior

The deletion persists (as in the original app): `loreSettings` is cleared on
the character and lorebook scanning falls back to global depth/budget; the
checkbox state survives reload. For B, the draft stays in sync with the server
value.

## Actual behavior

- A: only the component-local draft changes. No PATCH is sent; the server keeps
  the old `loreSettings`; prompt assembly keeps using per-character
  depth/budget/recursive settings; on panel remount / character switch /
  reload the checkbox reverts to "custom settings".
- B: the deletion never reaches the server, and `additionalAssets` stays in
  the draft's dirty set forever — until the character is re-selected, any
  external change to that field (another session, module apply, chat-side
  inlay quick-add) is masked in the open editor.

## Underlying cause

Field deletion is expressed as `undefined`, but the whole pipeline (draft
dispatch → local projection write → watcher diff → server PATCH) has no delete
sentinel; sanitize silently discards the edit without clearing the dirty
marker it caused.

## Affected data flow

1. **UI:** checkbox → draft write (`undefined`).
2. **Client:** dispatch effect marks the field dirty; sanitize empties the
   patch; projection untouched.
3. **Request:** none (watcher sees no diff).
4. **Server:** state unchanged.
5. **Displayed state:** cleared in the open editor; reverts on
   reseed/remount/reload; generation behavior unchanged throughout.

## Severity and likely user impact

**Medium-high** for trigger A — a persistent, silent divergence between UI,
projection, and server that changes actual generation behavior (lorebook scan
depth/token budget/recursion). **Low** for trigger B (narrow trigger, mostly a
convergence degradation).

## Recommended fix

Adopt the module pattern: write `loreSettings: null` (and `[]` for
`additionalAssets`, or `null` with sentinel support) from the handlers, add a
`CHARACTER_PATCH_DELETABLE_KEYS` set so sanitize keeps `null` for those keys,
apply it as a real delete in the local projection write and in the server
PATCH mutate. Additionally, drop keys from `dirtyFields` when sanitize removed
them from the outgoing patch — they can never be acknowledged.

## Test gap

Bridge test: set a draft field to `undefined`, assert either a delete-sentinel
PATCH is dispatched and the projection/server clear the field, or (before the
fix) that the defect reproduces; verify the dirty set does not retain
unsendable keys.
