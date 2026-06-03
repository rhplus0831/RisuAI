# Phase 7: Opportunistic Cleanups

Status: planned. One slice grouping the low-priority items. Each item is small and
independent; land them opportunistically.

Goal: land the audit's Low-severity cleanups — shallow-spread clones, scalar
baselines, regex memoization, an algorithmic rewrite, and a stray render-path log.
None is a freeze risk; they are cheap, safe reductions recorded so they are not
lost.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the Low findings and the clone-site inventory; recommended-remediation step 8.
- `src/ts/cbs.ts:364/376/399/1687` - `{{history}}`/`{{charhistory}}`/
  `{{userhistory}}` per-message clone+parse+stringify.
- `src/ts/observer.svelte.ts:118` - `safeStructuredClone(arg.body)` (Claude
  observer, gated behind an OFF-by-default experimental flag).
- `src/ts/characters.ts:138/195/220/242/259` - image/emotion edits cloning the
  full characters array + full target character.
- `src/ts/process/scripts.ts:215` - per-token `RegExp` recompile.
- `src/ts/parser/risuChatParser.ts:638` - the `{{#each}}` per-element splice +
  re-scan.
- `src/lib/ChatScreens/ChatBody.svelte:208` - per-render `console.log` of the full
  assets array.
- `src/lib/SideBars/SideChatList.svelte:444` - O(folders×chats) + O(chats²) scan.
- `src/lib/Setting/Pages/PersonaSettings.svelte:68` - personas double clone per
  keystroke (downgraded-to-low config-editor cleanup).

## Slices

- [`opportunistic-clone-cleanups.md`](slices/phase-7-opportunistic-cleanups/opportunistic-clone-cleanups.md) -
  the batch: shallow-spread the CBS history clones
  (`{ ...v, data: risuChatParser(v.data, matcherArg) }`); shallow-spread the
  Claude observer body (`{ ...arg.body, max_tokens: 10 }`); narrow the
  character image/emotion snapshots to a scalar baseline (reuse the Phase 0
  `CharacterRowSnapshot`); memoize compiled regexes in `scripts.ts`; rewrite the
  `{{#each}}` re-injection to avoid O(da.length) re-scan; remove the per-render
  `console.log`; and reduce the `SideChatList` folder/chat scan to a single pass.
  The personas double clone is an optional sub-item (sub-ms; cheap cleanup).

## Exit Criteria

- [ ] Each item is shallow-spread / scoped / memoized per the audit's per-finding
  fix; output (CBS render text, prompt assembly, persisted state) is
  byte-identical.
- [ ] The per-render `console.log` is removed; the `SideChatList` scan is single
  pass with identical ordering.
- [ ] `pnpm test` is green; no behavioral change is observable.

## Validation

- `pnpm test -- src/ts/cbs` and the per-file suites for the touched items.
- `pnpm test`
- `pnpm client-thinning:audit`
