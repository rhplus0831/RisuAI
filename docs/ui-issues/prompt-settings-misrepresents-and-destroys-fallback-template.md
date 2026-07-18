# Prompt Settings misrepresents and destroys the selected-fallback template

## Summary

When the selected prompt preset has no own `promptTemplate` — the supported
migrated/default state, for which the server explicitly ships
`selectedFallbackPromptTemplate` — opening Settings → Prompt Template shows an
empty editor while server generation keeps assembling the real fallback
template. Worse, the page's compatibility-mirror alignment deletes the
`database.promptTemplate` copy the hydration module just installed, corrupting
hydration bookkeeping: the next `ensurePromptTemplateHydrated()` un-hydrates
the owner and reports a spurious failure. Adding an item from the empty editor
persists a one-item preset-owned template that silently shadows the user's real
template.

## Location

- `src/lib/Setting/Pages/PromptSettings.svelte:272-278` —
  `cloneSelectedPromptPresetTemplate` returns `[]` whenever a preset object
  exists without an own template array; it never consults the fallback.
- `src/lib/Setting/Pages/PromptSettings.svelte:307-319` —
  `alignCompatibilityProjectionFromSelectedPromptPreset` deletes
  `getResourceDatabase().promptTemplate` when the preset lacks the
  own-template property.
- `src/ts/server/promptTemplateHydration.ts:180-204` — hydration installs the
  fallback into `database.promptTemplate` and tracks the owner in
  `promptTemplateSelectedFallbackOwnerIds`; the deferred fallback copy is
  single-use (deleted at 198 and 241).
- `src/ts/server/promptTemplateHydration.ts:215-243` —
  `applyHydratedOwnerCompatibilityProjection` re-derives the fallback from
  `deferredPromptTemplateSelectedFallbacks.get(ownerId) ?? getDatabase().promptTemplate`
  (line 223) and un-hydrates the owner when neither is an array (225-231).
- `server/fastify/src/routes/resourceReads.ts:716-727` — the server ships
  `selectedFallbackPromptTemplate` for exactly this preset state.
- Consumers that then misbehave: `src/lib/Setting/Pages/BotSettings.svelte:961-973`
  (template enable toggle reports "command unavailable"),
  `src/ts/process/promptAssembly/effectivePromptTemplate.ts:34-47`.

## Trigger

Have a selected prompt preset without an own `promptTemplate` (real template
lives top-level — the migrated scaffold state). Open Settings → Prompt
Template.

## Expected behavior

The editor shows the effective (fallback) template, clearly derived; the
compatibility mirror keeps the fallback so token math, warnings, and client
effective-template resolution stay correct.

## Actual behavior

1. The editor draft adopts `[]` — "no items", zero tokens — while server-side
   generation still uses the real fallback template (components disagree).
2. The alignment step deletes `database.promptTemplate`, destroying the mirror
   hydration installed.
3. The next plain `ensurePromptTemplateHydrated()` re-derives the fallback from
   the already-consumed deferred copy / now-deleted mirror, un-hydrates the
   owner, and returns `false` once — BotSettings' enable toggle shows a
   spurious "command unavailable" and PromptSettings flashes back to loading
   until a follow-up call refetches.
4. Clicking "+" in the empty editor persists a one-item preset-owned template
   that silently shadows the real one for future generations.

## Underlying cause

PromptSettings hand-rolls owner→compatibility mirroring without knowing the
hydration module's selected-fallback owner state, and the hydration module in
turn relies on `database.promptTemplate` retaining the fallback it wrote (its
deferred copy is single-use).

## Affected data flow

1. Mount → GET preset template → server sends `promptTemplate: null` +
   `selectedFallbackPromptTemplate`.
2. Hydration writes the fallback to `db.promptTemplate`, marks the owner
   hydrated with fallback ownership.
3. PromptSettings adopts: draft = `[]`; align deletes `db.promptTemplate`.
4. Editor misrepresents; later `ensurePromptTemplateHydrated()` un-hydrates and
   fails once; server generation continues using the fallback.

## Severity and likely user impact

**High.** Confidence: high (all three steps verified by direct read). The
primary template-editing surface misrepresents the active template for every
user in the supported fallback state, corrupts hydration bookkeeping just by
being viewed, and invites edits that silently shadow the real template.

## Recommended fix

Expose the fallback-owner state from `promptTemplateHydration` (e.g.
`promptTemplateOwnerUsesSelectedFallback(ownerId)` plus a durable fallback
getter). `cloneSelectedPromptPresetTemplate` should return the fallback for
such owners (labeled read-only/derived in the UI); the align step must not
delete `db.promptTemplate` for fallback owners (or should delegate to
`applyHydratedOwnerCompatibilityProjection`); keep a durable copy of the
applied fallback instead of a single-use deferred entry.

## Test gap

A test that hydrates an owner in the fallback state, mounts PromptSettings'
adoption logic, and asserts (a) the draft equals the fallback, (b)
`db.promptTemplate` survives, and (c) a subsequent
`ensurePromptTemplateHydrated()` returns true without refetching.
