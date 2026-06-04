# Phase 7: Opportunistic Cleanups

Status: implemented. All eight items landed (CBS history shallow-spread, Claude
observer shallow-spread, image/emotion scoped rollback, per-token regex memo,
`{{#each}}` prefix-drop re-injection, ChatBody render-log removal, SideChatList
single-pass grouping, and the optional PersonaSettings snapshot dedup).

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

- [x] Each item is shallow-spread / scoped / memoized per the audit's per-finding
      fix; output (CBS render text, prompt assembly, persisted state) is
      byte-identical.
- [x] The per-render `console.log` is removed; the `SideChatList` scan is single
      pass with identical ordering.
- [x] `pnpm test` is green; no behavioral change is observable.

## Landed

| Item | Commit | Gate test |
| --- | --- | --- |
| CBS history shallow-spread | `d96d04c7` | `parser/tests/cbs/history.test.ts` |
| Claude observer shallow-spread | `e5c98d19` | (trivial, experimental path) |
| Image/emotion scoped rollback | `2c1456ef` | `characters.imageEmotion.test.ts` |
| Per-token regex memo | `62acd3e3` | `process/scripts.regexCache.test.ts` |
| `{{#each}}` prefix-drop re-injection | `daa15c59` | `parser/tests/cbs/eachReinjection.test.ts` |
| ChatBody render-log removal | `6bf59815` | (debug-log deletion) |
| SideChatList single-pass grouping | `ba3d53d1` | `SideBars/chatFolderGrouping.test.ts` |
| PersonaSettings snapshot dedup (optional) | `6861494d` | (clone dedup; svelte-check) |

## Validation

- Add focused tests for the touched item(s), then run the nearest existing suites.
- `pnpm test`
- `pnpm client-thinning:audit`
