# Slice: DOM Observer Idempotent Bindings

Phase: [6](../../phase-6-bridges-lifecycle-network.md). Finding: M14.
Runtime change.

## Scope

Make DOM observation for code-block context menus and `risu-ctrl` nodes
idempotent. Remove the 10 Hz whole-document polling path if the existing
`MutationObserver` can be wired safely; otherwise at minimum ensure repeated
observe ticks never attach duplicate listeners.

This slice does not own parser output, code-block markup, BGM feature changes,
or the separate long-lived Claude observer interval.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M14.
- `src/ts/observer.svelte.ts`: `nodeObserve`, `startObserveDom`, constructed
  but unused `MutationObserver`, `contextmenu` listener, `risu-ctrl` handling.
- `src/ts/bootstrap.ts`: app-lifetime `startObserveDom()` call.
- New focused test home:
  `src/ts/observer.svelte.test.ts`.

## Target Shape

- Make node processing idempotent with a `WeakSet`, `WeakMap`, or data
  attribute. A stable `[x-hl-lang]` node must receive exactly one
  `contextmenu` handler for its lifetime.
- Prefer wiring `MutationObserver.observe(document.body, { childList: true,
  subtree: true })`, performing one initial scan, and then processing added
  nodes plus matching descendants from each mutation.
- If handlers are stored in a `WeakMap`, detach them when observed mutations
  remove the node or a matching descendant. If using only a `WeakSet`, prove the
  listener growth is fixed and removed DOM nodes remain GC-eligible.
- Keep context-menu behavior unchanged: right-click prevents default, replaces
  any existing `#code-contextmenu`, offers Copy and Download, positions at the
  pointer, and removes on the next document click.
- Keep `risu-ctrl="bgm___..."` behavior one-shot per node. The observer should
  not replay BGM startup on every poll or on unrelated DOM mutations.
- Add listener-count tests that call observation repeatedly against the same
  node and assert one `contextmenu` listener. Add a mutation test proving newly
  inserted matching descendants are processed.
- Register M14 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- `startObserveDom()` is still safe to call during bootstrap and must not throw
  if `document.body` is not ready; if startup can race body creation, retry or
  observe after body exists.
- Nodes that gain `x-hl-lang` or `risu-ctrl` after insertion are either handled
  by attribute observation or by a documented remaining scan path that is
  idempotent and bounded.
- The same visible code block cannot accumulate duplicate handlers across
  Svelte remounts, re-renders, or repeated observer callbacks.
- Removing one code block must not remove the context-menu behavior from a
  different still-mounted block.

## Done Criteria

- Repeated observation of the same code block binds one and only one
  `contextmenu` listener.
- Adding a nested matching node through a DOM mutation binds it without a 10 Hz
  full-document poll.
- Context-menu copy/download behavior still works.
- M14 v2 gate entry points at a real focused test and the risk-map row is
  `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/observer.svelte.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
