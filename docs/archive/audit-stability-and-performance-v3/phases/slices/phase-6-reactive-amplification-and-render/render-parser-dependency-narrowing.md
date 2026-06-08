# Slice: Render Parser Dependency Narrowing

Phase: [6](../../phase-6-reactive-amplification-and-render.md). Findings:
v4-M1 and v4-L22. v4-L23 is measure-first/free-rider only. Client parser
reactivity performance change.

## Scope

Narrow render parser dependencies so guarded projection writes during
streaming do not re-run the full parser for every visible message or
background HTML surface.

This slice owns `Chat.svelte`'s per-message `$effect.pre`/`displaya()` path
and `BackgroundDom.svelte`'s background parser dependency. It may touch parser
helper code only when required by the narrowed dependency shape; otherwise
v4-L23 remains unscheduled. It does not change parser output, message
visibility, customHTML template memoization, ChatBody parse-memo key caching,
translation behavior, or the projection guard.

## Anchors

- [`../../../../../audit-stability-and-performance-v4.md`](../../../../../audit-stability-and-performance-v4.md)
  v4-M1, v4-L22, and v4-L23.
- [`../../../v4-integration-brief.md`](../../../v4-integration-brief.md)
  Phase 6 amendments and render budget gate.
- `src/lib/ChatScreens/Chat.svelte`: `$effect.pre`, `displaya()`,
  `getCbsCondition()`, `message`, `data`, and customHTML branch boundaries.
- `src/lib/ChatScreens/ChatBody.svelte`: prop-scoped
  `getCbsCondition()` precedent.
- `src/lib/BackgroundDom.svelte`: background HTML `$derived` and
  `ParseMarkdown` await path.
- `src/ts/process/postGeneration/streamResponse.ts`: animation-frame
  guarded-write driver during streaming.
- `src/ts/server/projectionWriteGuard.svelte.ts`: deliberate proxy re-mint
  design.
- `src/ts/parser/risuChatParserHelpers.ts`: v4-L23 free-rider/measure-first
  helper only if this slice already touches parser helpers.

## Target Shape

- In `Chat.svelte`, make `getCbsCondition()` depend on already-available
  message props or untracked projection reads instead of broad
  `DBState.db...` access. The `ChatBody.svelte` prop-scoped condition helper
  is the preferred precedent.
- A guarded streaming-frame write should not invalidate every visible
  message's parser effect. It may re-run parsing for the streaming/changing
  message, an explicit reload pointer, or a prop change that truly affects the
  message.
- Keep `msgDisplay` equality as a DOM churn guard, but do not rely on it as
  the performance fix; the parser call itself must be avoided.
- In `BackgroundDom.svelte`, replace broad background dependencies with a
  narrow signature or untracked read keyed by the selected character/background
  HTML and any cbs-condition inputs that actually affect the background.
- `BackgroundDom` should not call `risuChatParser` or `ParseMarkdown` on
  unrelated guarded projection writes, including streaming-frame writes.
- v4-L23 remains measure-first. If `risuChatParserHelpers.ts` is touched for
  this slice anyway, it may memoize or lazily construct
  `Intl.DateTimeFormat` instances as a free rider, with a small proof. Do not
  schedule it as mandatory Phase 6 work.
- Register no v3 IDs as `DONE` for the v4-only findings. If this work also
  changes v3-L31 customHTML code, keep that proof in the existing
  `customhtml-template-memo` slice.

## Invariants

- Rendered text/HTML stays byte-identical for the same parser inputs.
- CBS condition semantics remain unchanged for first-message, role, display,
  customHTML, and background cases.
- Explicit reload pointers and real message/background changes still
  invalidate the parser.
- The projection proxy re-mint remains intentional; this slice fixes the
  consumers.
- Parser helper cache additions, if any, must be bounded or keyed by stable
  format strings and must not alter locale/time output.

## Done Criteria

- A `Chat.svelte` parser call-count test proves a streaming-frame guarded
  write does not re-run `risuChatParser` for every visible row.
- The same test proves changing the active/streaming message or explicit
  parser invalidator still re-runs the correct row.
- A `BackgroundDom` render/parser-count test proves unrelated guarded writes
  do not re-run `risuChatParser`/`ParseMarkdown` for background HTML.
- A `BackgroundDom` invalidation test proves selected character/background
  HTML or relevant cbs-condition changes still re-render the background.
- v4-L23 is either documented as not touched, measured if profiled, or covered
  by a small free-rider helper test if parser helper code changed.
- Phase 6 verification records parser/render call-count proof paths for both
  `Chat.svelte` and `BackgroundDom`.

## Validation

```bash
pnpm exec vitest run \
  src/lib/ChatScreens/Chat.parserDependencies.test.ts \
  src/lib/BackgroundDom.parserDependencies.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
