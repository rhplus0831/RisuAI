# Slice: CustomHTML Template Memo

Phase: [6](../../phase-6-reactive-amplification-and-render.md). Finding:
L31. Client customHTML render performance change.

## Scope

Memoize customHTML GUI template parsing so each rendered message does not
call `risuChatParser` and `DOMParser` for the same template during the same
render cycle.

This slice owns the customHTML branch in `Chat.svelte`, including
`RenderGUIHtml` and `renderGuiHtmlPart`. It does not change message parsing,
theme selection, trusted HTML handling, template syntax, cbs-condition
semantics, or the customHTML renderer's allowlist.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L31.
- `src/lib/ChatScreens/Chat.svelte`: `RenderGUIHtml`,
  `renderGuiHtmlPart`, `renderChilds`, customHTML branch at
  `DBState.db.theme === 'customHTML'`, and `ReloadGUIPointer` display
  effect.
- `src/ts/parser/risuChatParser.ts` and cbs-condition helpers used by the
  current render path.
- Focused tests may live beside existing Chat/ChatBody tests; add
  `src/lib/ChatScreens/Chat.customHtml.test.ts` if there is no suitable
  existing file.

## Target Shape

- Derive a template version key from the real invalidators:
  `DBState.db.guiHTML` and the cbs-condition data read by
  `risuChatParser(html, { cbsConditions: getCbsCondition() })`.
- Do not key the template parse on `ReloadGUIPointer` unless a real
  dependency still requires it. The audit calls out `ReloadGUIPointer` as the
  wrong broad invalidator for this parse.
- Parse the GUI template once per version and share it across messages.
  Sharing a read-only parsed `body` is acceptable because the renderer reads
  attributes, text, and child nodes instead of inserting those DOM nodes
  directly. Cloning from the cached body before rendering is also acceptable
  if tests prove equivalent behavior.
- Preserve the existing error fallback: parse errors return an empty
  placeholder element and do not throw through render.
- Keep `renderGuiHtmlPart` behavior byte-identical for supported tags and
  fallback tags.
- Register L31 as `DONE` in the v3 gate and flip only the L31 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).

## Invariants

- Rendering the same message under the same customHTML template produces the
  same DOM/text output as before.
- cbs-condition changes that affect the parsed template must invalidate the
  memo.
- A `guiHTML` edit must invalidate the memo immediately.
- The memo must not introduce shared mutable DOM state between rendered
  messages.
- Non-customHTML themes are untouched.

## Done Criteria

- A focused regression proves multiple rendered messages under the same
  customHTML template call `risuChatParser`/`DOMParser` once per template
  version, not once per message.
- A `guiHTML` change or relevant cbs-condition change re-parses the template.
- Parse errors still render the placeholder path without throwing.
- L31 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/lib/ChatScreens/Chat.customHtml.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
