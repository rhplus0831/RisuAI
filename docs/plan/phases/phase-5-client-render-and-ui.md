# Phase 5: Client Render & UI (Root 4)

Status: pending. Lands after Phase 1 (H3 owns the remount decoupling this
phase builds on). Independent of Phases 4/6/7/8 otherwise.

Goal: per-render and per-keystroke costs in the chat screen and editors that
remain after H3 — content-keyed parse memos, editor debounce, and unmemoized
list scans.

Findings: M13, M17, L38, L39, L40, L41, L42, L43, L44.

## Slices

- M13:
  [`slices/phase-5-client-render-and-ui/prompt-template-tokenize-debounce.md`](slices/phase-5-client-render-and-ui/prompt-template-tokenize-debounce.md)
  - debounce prompt-template token counts and memoize per-item tokenization.
- M17/L40:
  [`slices/phase-5-client-render-and-ui/chatbody-content-keyed-parse-memo.md`](slices/phase-5-client-render-and-ui/chatbody-content-keyed-parse-memo.md)
  - add a bounded module-level parse/translate-detection memo for `ChatBody`.
- L38/L39:
  [`slices/phase-5-client-render-and-ui/parser-render-fast-paths.md`](slices/phase-5-client-render-and-ui/parser-render-fast-paths.md)
  - remove parser logs and fast-path thought/tool parsing.
- L41:
  [`slices/phase-5-client-render-and-ui/partial-edit-shared-hover-handler.md`](slices/phase-5-client-render-and-ui/partial-edit-shared-hover-handler.md)
  - share partial-edit hover tracking across visible messages.
- L42:
  [`slices/phase-5-client-render-and-ui/grid-catalog-derived-lists.md`](slices/phase-5-client-render-and-ui/grid-catalog-derived-lists.md)
  - derive and key `GridCatalog` character lists.
- L43:
  [`slices/phase-5-client-render-and-ui/module-settings-derived-search.md`](slices/phase-5-client-render-and-ui/module-settings-derived-search.md)
  - derive and key `ModuleSettings` search results.
- L44:
  [`slices/phase-5-client-render-and-ui/sidebar-character-list-signature.md`](slices/phase-5-client-render-and-ui/sidebar-character-list-signature.md)
  - replace sidebar list deep-compare with a cheap signature or derived memo.
- Proof:
  [`slices/phase-5-client-render-and-ui/phase-5-verification-refresh.md`](slices/phase-5-client-render-and-ui/phase-5-verification-refresh.md)
  - refresh gates, focused proofs, full validation, and latest verification.

## Source Anchors

- [`../audit-stability-and-performance-v2.md`](../audit-stability-and-performance-v2.md) -
  M13, M17, L38-L44.
- M13: `src/lib/Setting/Pages/PromptSettings.svelte` (`$effect.pre` ->
  `executeTokenize`, both `consti` passes per keystroke); debounce precedent
  `CharConfig.svelte` `scheduleTokenize`.
- M17: `src/lib/ChatScreens/ChatBody.svelte` (LLM cached-only translate
  detection: extra `ParseMarkdown` + IndexedDB read, reset by the H3
  remount).
- L38: `src/ts/parser/risuChatParser.ts` (`{{#function}}`/`{{call::}}`
  logs).
- L39/L40: `src/ts/parser/parser.svelte.ts` (`parseThoughtsAndTools`),
  `ChatBody.svelte` (no content-keyed `ParseMarkdown` memo — must be
  module-level; instance state dies on remount).
- L41: `src/lib/ChatScreens/PartialEditController.svelte` (per-message
  document mousemove).
- L42/L43/L44: `src/lib/Others/GridCatalog.svelte`,
  `src/lib/Setting/Pages/Module/ModuleSettings.svelte`,
  `src/lib/SideBars/Sidebar.svelte`.

## Planned Shape

- L40 and M17 share one mechanism: a module-level content-keyed memo
  (message content + char identity key + translate/retranslate flags) that
  survives remounts. Build it once; both findings consume it. Coordinate
  with H3 — if the remount is gone for var-only changes, the memo's job is
  the remaining reload classes.
- M13: trailing debounce (250-400 ms + run counter) and per-item
  `(id, text, innerFormat)` memo; compute the `consti` variants once.
- L42/L43: wrap the template calls in `$derived` and key the `{#each}`
  blocks; behavior-identical filtering.
- The render-count probe from Phase 0 is the proof harness for M17/L40.

## Exit Criteria

- [ ] M13: typing in a prompt item triggers at most one (debounced) template
      tokenize; token counts displayed unchanged after settle.
- [ ] M17/L40: an unchanged message re-derivation performs zero
      `ParseMarkdown` runs (memo hit), across a simulated GUI reload;
      changed messages still re-parse.
- [ ] L38/L39: logs removed / fast path added with focused tests; parse
      output identical.
- [ ] L41: one shared mousemove handler regardless of visible-message count;
      partial-edit behavior unchanged.
- [ ] L42/L43/L44: scans memoized via `$derived`/signature compare; list
      behavior identical (svelte-check clean).
- [ ] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run src/ts/process/scripts.editdisplay.test.ts src/ts/process/scripts.regexCache.test.ts
pnpm test
pnpm check   # svelte-check; respect the pre-existing baseline count
pnpm client-thinning:audit
```
