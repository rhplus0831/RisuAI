# Opportunistic Clone Cleanups

Status: planned. Phase 7. Small independent cleanups.

## Scope

Low-severity items: shallow-spread clones, scalar baselines, regex memoization,
one parser rewrite, one render-path log, and one folder/chat scan reduction.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the Low findings and the clone-site inventory.
- `src/ts/cbs.ts:364/376/399/1687`, `src/ts/observer.svelte.ts:118`,
  `src/ts/characters.ts:138/195/220/242/259`, `src/ts/process/scripts.ts:215`,
  `src/ts/parser/risuChatParser.ts`, `src/lib/ChatScreens/ChatBody.svelte:208/216`,
  `src/lib/SideBars/SideChatList.svelte`,
  `src/lib/Setting/Pages/PersonaSettings.svelte:68`.

## Items

- CBS history (`cbs.ts:376/399/1687`): shallow-copy and reparse only `.data` with
  `JSON.stringify({ ...v, data: risuChatParser(v.data, matcherArg) })`.
- Claude observer (`observer.svelte.ts:118`): shallow-spread body into
  `{ ...arg.body, max_tokens: 10 }`.
- Character image/emotion (`characters.ts:138/195/220/242/259`): drop the full
  characters-array rollback. Reuse the character-row dispatch pattern (which still
  clones the target row) or add an image/emotion-specific snapshot if a narrower
  rollback is worthwhile.
- Per-token regex (`scripts.ts:215`): memoize compiled `RegExp` per regex-script
  source.
- `{{#each}}` reinjection (`risuChatParser.ts`): reduce block-expansion string
  work while preserving nested and flat output.
- Render logs (`ChatBody.svelte:208/216`): remove the image lookup logs,
  including the full-assets `console.log`.
- `SideChatList` scan: reduce folder/chat scans to one pass with the
  same ordering.
- Personas clone (`PersonaSettings.svelte:68`): optional; drop one bounded
  `cloneJsonValue(DBState.db.personas)` pass.

## Behavior / Invariants

- CBS render text, prompt assembly, persisted state, and rendered DOM order are
  byte-/order-identical.
- The image/emotion rollback still restores the mutated avatar/emotion fields on
  failure and does not clone unrelated characters.
- The `{{#each}}` rewrite produces identical output for nested and flat templates.

## Done When

- Each item is shallow-spread, scoped, memoized, or removed as listed; no
  behavioral change is observable.
- The per-render `console.log` is gone; the `SideChatList` scan is single-pass.
- `pnpm test` is green.

## Validation

- Add focused tests for the touched item(s), then run the nearest existing suites.
- `pnpm test`
- `pnpm client-thinning:audit`
