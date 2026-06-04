# Phase 7: Opportunistic Cleanups

Status: planned. One slice grouping the low-priority items. Each item is small and
independent; land them opportunistically.

Goal: land Low-severity cleanups: shallow-spread clones, scoped row baselines,
regex memoization, parser string-work reduction, and a stray render-path log.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the Low findings and the clone-site inventory; recommended-remediation step 8.
- `src/ts/cbs.ts` - `{{history}}`/`{{charhistory}}`/`{{userhistory}}`
  per-message clone+parse+stringify.
- `src/ts/observer.svelte.ts` - `safeStructuredClone(arg.body)` (Claude
  observer, gated behind an OFF-by-default experimental flag).
- `src/ts/characters.ts` - image/emotion edits cloning the
  full characters array + full target character.
- `src/ts/process/scripts.ts` - per-token `RegExp` recompile.
- `src/ts/parser/risuChatParser.ts` - `{{#each}}` block expansion string work.
- `src/lib/ChatScreens/ChatBody.svelte` - per-render image lookup
  `console.log`s, including the full assets array.
- `src/lib/SideBars/SideChatList.svelte` - O(folders\*chats) + O(chats^2) scan.
- `src/lib/Setting/Pages/PersonaSettings.svelte` - personas double clone per
  keystroke (downgraded-to-low config-editor cleanup).

## Slices

- [`opportunistic-clone-cleanups.md`](slices/phase-7-opportunistic-cleanups/opportunistic-clone-cleanups.md) -
  shallow-spread CBS and observer payloads, scope image/emotion rollback, memoize
  regexes, rewrite `{{#each}}` reinjection, remove the render log, and make
  `SideChatList` scan once.

## Exit Criteria

- [ ] Each item is shallow-spread / scoped / memoized per the audit's per-finding
      fix; output (CBS render text, prompt assembly, persisted state) is
      byte-identical.
- [ ] The per-render `console.log` is removed; the `SideChatList` scan is single
      pass with identical ordering.
- [ ] `pnpm test` is green; no behavioral change is observable.

## Validation

- Add focused tests for the touched item(s), then run the nearest existing suites.
- `pnpm test`
- `pnpm client-thinning:audit`
