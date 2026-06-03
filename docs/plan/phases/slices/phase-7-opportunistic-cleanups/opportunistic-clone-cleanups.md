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
  `src/ts/parser/risuChatParser.ts:638`, `src/lib/ChatScreens/ChatBody.svelte:208/216`,
  `src/lib/SideBars/SideChatList.svelte:444`,
  `src/lib/Setting/Pages/PersonaSettings.svelte:68`.

## Items

- CBS history (`cbs.ts:376/399/1687`): shallow-copy and reparse only `.data` with
  `JSON.stringify({ ...v, data: risuChatParser(v.data, matcherArg) })`.
- Claude observer (`observer.svelte.ts:118`): shallow-spread body into
  `{ ...arg.body, max_tokens: 10 }`.
- Character image/emotion (`characters.ts:138/195/220/242/259`): reuse
  `CharacterRowSnapshot` and capture only image/emotion fields.
- Per-token regex (`scripts.ts:215`): memoize compiled `RegExp` per regex-script
  source.
- `{{#each}}` reinjection (`risuChatParser.ts:638`): avoid per-element
  splice-into-source plus re-scan.
- Render logs (`ChatBody.svelte:208/216`): remove the image lookup logs,
  including the full-assets `console.log`.
- `SideChatList` scan (`:444`): reduce folder/chat scans to one pass with the
  same ordering.
- Personas clone (`PersonaSettings.svelte:68`): optional; drop one bounded
  `cloneJsonValue(DBState.db.personas)` pass.

## Behavior / Invariants

- CBS render text, prompt assembly, persisted state, and rendered DOM order are
  byte-/order-identical.
- The image/emotion rollback still restores the mutated avatar/emotion fields on
  failure (reuse the `CharacterRowSnapshot` correctness property).
- The `{{#each}}` rewrite produces identical output for nested and flat templates.

## Done When

- Each item is shallow-spread, scoped, memoized, or removed as listed; no
  behavioral change is observable.
- The per-render `console.log` is gone; the `SideChatList` scan is single-pass.
- `pnpm test` is green.

## Validation

- `pnpm test -- src/ts/cbs` and the per-file suites for the touched items.
- `pnpm test`
- `pnpm client-thinning:audit`
