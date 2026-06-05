# Slice: Language Change Same-Code Cache

Phase: [4](../../phase-4-client-clone-ring-2.md). Finding: L37. Runtime
change.

## Scope

Add a same-language early return to `changeLanguage` so repeated projection or
database applies do not reclone and remerge the English language pack when the
language code has not changed.

This slice does not change language pack content, fallback language selection,
or settings persistence.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L37.
- `src/lang/index.ts`: `changeLanguage`, exported `language`.
- `src/ts/storage/database.svelte.ts`: callers around projection/database
  apply.
- `src/ts/setting/languageSettingsData.svelte.ts`: language option surface.
- New or existing focused test home: `src/lang/index.test.ts`.

## Target Shape

- Track the last applied normalized language code in module scope.
- Return early when `changeLanguage` is called with the same normalized code.
- Preserve the existing fallback behavior for unknown language codes: unknown
  inputs resolve to English and should share the English cache key.
- Keep first call behavior unchanged for every supported language.
- Add a test that instruments `safeStructuredClone` or observes object identity
  to prove repeated calls with the same code do not rebuild the merged pack.
- Add behavior tests for switching between two languages and switching back to
  English.
- Register L37 as `DONE` in the v2 gate with focused behavior/cost tests, and
  flip the L37 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Supported language codes still produce the same merged strings as before.
- Unknown language codes still select English.
- A real language switch must rebuild `language` so Svelte consumers observe
  the changed object.
- The early return must not hide language pack updates during hot module reload
  in tests; reset helpers are acceptable if tests need them.

## Done Criteria

- Repeating `changeLanguage` with the already-applied language performs no
  clone/merge work.
- Switching languages still changes exported `language` content.
- Unknown-code fallback remains English.
- The v2 gate and active-risk row mark L37 `DONE`.

## Validation

```bash
pnpm exec vitest run src/lang/index.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
