# Slice: Translation UI Race And Retry Bounds

Phase: [7](../../phase-7-opt-in-subsystems.md). Findings: L58, L59. Runtime
change. Status: done on 2026-06-06.

## Scope

Make translated suggestions and chat-body parse retries bounded under
translation failures. This slice owns UI-level concurrency and retry behavior,
not the translator cache, Google streaming guard, or bergamot global chain.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L58 and L59.
- `src/lib/ChatScreens/Suggestion.svelte`: `suggestionRequestId`,
  `suggestMessages`, `suggestMessagesTranslated`, `translateSuggest`.
- `src/lib/ChatScreens/ChatBody.svelte`: `markParsing`, `translateHTML`,
  `ParseMarkdown`, retry block.
- Existing adjacent suites:
  `src/ts/translator/presets.test.ts`,
  `src/ts/parser/tests/`.
- New focused test homes:
  `src/lib/ChatScreens/Suggestion.svelte.test.ts`,
  `src/lib/ChatScreens/ChatBody.svelte.test.ts`.

## Target Shape

- Wire `translateSuggest` into the existing suggestion epoch. Each translate
  run should capture a request/translation id and a snapshot of the `messages`
  argument it was asked to translate.
- Do not read live `suggestMessages` while translating a captured snapshot.
- Commit `suggestMessagesTranslated` only if the epoch still matches the latest
  run and the source message array is still current. Older overlapping runs
  must become no-ops.
- Clear translated suggestions deliberately when translation is disabled or the
  source message list is empty.
- Split `markParsing` so a `translateHTML` network/provider failure is not
  retried through the full `translateHTML` + `ParseMarkdown` pipeline four
  times. Only parser failures should use the existing bounded parse retry.
- If translation succeeds and parsing fails, retry parsing against the already
  translated text rather than translating again.
- Keep the user-facing fallback explicit: on persistent translation failure,
  surface the error once through the current error path and return the safest
  existing fallback for the message.
- Add tests for overlapping slow/fast suggestion translations, source-message
  mutation mid-loop, toggle-off cleanup, translation failure count in
  `markParsing`, and parse-only retry count.
- Register L58 and L59 as `DONE` in the v2 gate with focused tests, and flip
  both rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Successful suggestion translations keep the same order and text as before.
- The suggestion creator's existing `suggestionRequestId` behavior for request
  generation remains intact.
- `markParsing` still retries parser failures up to the existing bound.
- Translation network failures must not call `translateHTML` more than once for
  the same render attempt.

## Done Criteria

- Overlapping `translateSuggest` runs cannot interleave old translated rows
  into a newer suggestion list.
- Persistent Google or bergamot translation errors do not cause four full
  translation + markdown parse passes.
- L58 and L59 v2 gate entries point at real focused tests and the risk-map rows
  are `DONE`.

## Completed Proof

- `src/lib/ChatScreens/Suggestion.svelte.test.ts`
  - `L58: keeps only the newest overlapping translated suggestion run`
  - `L58: snapshots source messages and refuses a mutated-source commit`
  - `L58: clears translated suggestions when translation is disabled`
- `src/lib/ChatScreens/ChatBody.svelte.test.ts`
  - `L59: surfaces translateHTML failure once without retrying the full pipeline`
  - `L59: retries parser failures against already translated HTML only`

## Validation

```bash
pnpm exec vitest run src/lib/ChatScreens/Suggestion.svelte.test.ts src/lib/ChatScreens/ChatBody.svelte.test.ts src/ts/parser/tests
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
