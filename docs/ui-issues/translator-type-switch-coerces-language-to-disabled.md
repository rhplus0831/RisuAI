# Translator type switch coerces the translator language to disabled

## Summary

The translator-language select gates `zh-TW` and `fa` behind
`translatorType === 'google'` and configures `selectFallbackValue: ''` — the
"disabled" sentinel. Switching the translator type away from Google while one of
those languages is selected therefore triggers the wrappers' hidden-option
coercion, which persists `translator: ''` and disables the whole translation
subsystem mid-interaction, unmounting the section the user is working in.

## Location

- `src/ts/setting/languageSettingsData.svelte.ts:100-115` — the translator
  select: `selectFallbackValue: ''`; `zh-TW` and `fa` options carry
  `condition: (ctx) => ctx.db.translatorType === 'google'`.
- `src/ts/setting/languageSettingsData.svelte.ts:128-143` — the
  `translatorType` select and every following translator row are gated on
  `condition: (ctx) => !!ctx.db.translator`.
- `src/lib/Setting/Wrappers/SettingSelect.svelte:63-85` — coercion effect that
  rewrites a value whose option became hidden.

## Trigger

1. Set translator language to `zh-TW` (or `fa`) with translator type Google — a
   valid persisted state.
2. In Language settings, switch translator type to DeepL, Ax. Model, or
   DeepL X.

## Expected behavior

The type changes; the language either stays (mapped to a supported neighbor at
request time) or the user is asked to re-pick a language.

## Actual behavior

The `zh-TW` option hides, the coercion effect persists the configured fallback
`''`, i.e. translation disabled. Every `!!ctx.db.translator`-conditioned row —
including the type select the user just used and the whole preset editor —
unmounts instantly. `autoTranslate` remains `true` but nothing translates.

## Underlying cause

The coercion fallback for this select is the "disabled" sentinel, so a
visibility-driven coercion escalates into disabling the subsystem. The option
conditions couple language availability to provider choice even though the
value itself is meaningful to other providers.

## Affected data flow

1. Type select → settings PATCH persists `translatorType`.
2. `ctx` recomputes; the `zh-TW` option's condition now fails.
3. Coercion effect rewrites `localValue` to `''`; write-back dispatches
   `PATCH settings` with `translator: ''`.
4. All translator rows conditioned on `!!ctx.db.translator` unmount.

## Severity and likely user impact

**Medium.** Confidence: medium-high — the mechanism is certain (it is the same
coercion path as the hidden-option issue, reachable without any concurrency);
the judgment call is that coercing to the disabled sentinel is a defect rather
than intended. Users with Traditional Chinese or Farsi silently lose
translation when trying out another provider.

## Recommended fix

Fall back to a supported neighbor (`zh-TW` → `zh`) instead of `''`, or drop the
Google-only option conditions and map unsupported codes per backend at request
time. As a rule, a select's coercion fallback should never be a value that
unmounts the control's own section.

## Test gap

A settings-data test: with `translator: 'zh-TW'`, change `translatorType` to
`'deepl'` through the rendered select and assert `translator` is not persisted
as `''`.
