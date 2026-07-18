# Legacy panel provider keys write dead fields for profile-bound roles

## Summary

The legacy Bot Settings panel decides which provider API-key inputs to show
from the union of *resolved* role providers — which includes roles bound to
durable model profiles. But the inputs still write the legacy top-level
settings fields (`claudeAPIKey`, etc.), which the durable-profile dispatch path
never reads. A user who rotates a key there sees it saved, yet generation keeps
using (or keeps missing) the profile's own stored key.

## Location

- `src/lib/Setting/Settings.svelte:332-340` — the legacy Bot Settings panel
  renders whenever legacy `botPresets` remain.
- `src/lib/Setting/Pages/BotSettings.svelte:1217-1245` — `usesAnthropicProvider`
  and friends derive from `resolveModelProfileUiState`, which includes
  durable-profile-bound roles.
- `src/lib/Setting/Pages/BotSettings.svelte:1405-1414` — the Claude key input
  writes legacy `claudeAPIKey` via a server-backed setting draft; the same
  pattern covers Google/Mistral/Cohere/OpenAI/NovelAI/etc. in the surrounding
  block.
- `server/fastify/src/prompt/chatDispatch.ts:763-786,815-827` — the profile
  path reads only `profile.providerOptions.apiKey`, with no legacy-field
  fallback; legacy keys are consulted only in the no-profile path
  (`:583-608`).
- `src/ts/model/modelProfileResolver.ts:1236,1423-1428` — profile status and
  key resolution ignore legacy fields (`api-key-missing` when the profile has
  none).
- Original comparison: `/home/codex/Risuai/src/lib/Setting/Pages/BotSettings.svelte:199-203`
  gated the same inputs on the legacy `aiModel`/`subModel` — the actual
  consumers of those fields.

## Trigger

A user who still has legacy `botPresets` (so the legacy panel renders) and
roles bound to a durable Anthropic (or other provider) profile updates the
corresponding API key in Bot Settings — e.g. after rotating a key that started
failing.

## Expected behavior

The key used for generation updates, or the input is not offered when the only
usage of that provider is a durable profile (with a pointer to the profile
editor instead).

## Actual behavior

The typed key persists into the legacy settings field. Generation for
durable-profile roles keeps using the profile's stored key (or keeps failing
`api-key-missing`). The edit is persisted but functionally dead, and the panel
disagrees with the profile editor about the effective credential.

## Underlying cause

The migration widened the input-visibility gates from legacy-model checks to
resolved-role-union checks without re-pointing the write target at the profile
that triggered visibility.

## Affected data flow

1. Durable profile resolves to Anthropic → `usesAnthropicProvider` true →
   legacy key input renders.
2. Input → `createServerBackedSettingDraft('claudeAPIKey')` → settings PATCH →
   legacy field persisted.
3. Server dispatch takes the profile path → `providerOptions.apiKey` only →
   old key still used; no feedback.

## Severity and likely user impact

**Medium.** Confidence: medium — the mechanics are verified; the defect
judgment is that the input's visibility promises an effect its write target
cannot deliver. Confusing auth failures after key rotation during exactly the
migration window this panel exists to serve.

## Recommended fix

Gate each legacy key input on whether any *legacy-mode* role resolves to that
provider (e.g. exclude roles whose `source.kind === 'durable-profile'` from the
`usesX` union), or annotate the input when every matching role is
profile-bound and deep-link to the owning profile's editor drawer.

## Test gap

A UI-state test: with all roles bound to a durable Anthropic profile and no
legacy Anthropic model, assert the Claude key input is hidden (or annotated),
and that showing it requires a legacy-sourced role.
