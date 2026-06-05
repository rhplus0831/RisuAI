# Memoization & Hygiene

Status: DONE (`151c6978`, one batch). Phase 7. Bundles regex/compile
memoization, redundant DB work, and logging cleanup. Output and behavior stayed
unchanged (the M2/L3 compile-count tests pin byte-identical outputs; the L9
end-to-end delete test pins identical deleted rows and `writtenTables`).

## Scope

Hoist invariant work, memoize compiled regexes, drop redundant DB work, and
remove warm/render-path logging.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  M2, L3, L8, L9, L37, L38, L39, L40.
- `server/fastify/src/prompt/scripts.ts` (`PreparedScript`, `prepareOne`,
  `getPreparedScripts`), `server/fastify/src/prompt/modules.ts`
  (`NO_ACTIVE_MODULES`) (M2),
  `server/fastify/src/prompt/lorebook.ts` (`getCompiledLoreKeyRegex`) (L3).
- `server/fastify/src/commands/events.ts` (`pruneCommandEventHistory`) (L8),
  `server/fastify/src/routes/commands.ts` character delete +
  `repository.ts` `deleteCharacterRow` FK cascade (L9).
- `src/ts/process/command.ts`, `src/ts/storage/database.svelte.ts`
  (`downloadPreset`) (L37), `src/ts/process/scripts.ts` (`processScriptFull`
  editdisplay) (L38), `src/ts/process/serverBackedSendChat.ts`
  (`findGeneratedAssistantMessage`) (L39),
  `src/ts/process/triggers.ts` → `scripts.ts` `getCompiledRegex` (L40).

## Item Checklist

- [x] M2 — module resolution + `parseScripts` + the compiled RegExp list are
      hoisted once per assembly (per-`Database` WeakMap memo consumed by every
      `processScript` call, including `formatHistoryMessage`'s per-message
      walk); cbs-action scripts excluded (they pre-expand their source per
      message).
- [x] L3 — the lorebook keyword regexes compile once per key string
      (bounded memo, `lastIndex` reset on retrieval) outside the recursive
      activation loop.
- [x] L40 — the 9 trigger-effect `new RegExp` sites reuse `getCompiledRegex`
      (`lastIndex` resets on retrieval; memo lives per pass for var-writing
      triggers because the pass-end `ReloadGUIPointer` bump resets the cache).
- [x] L8 — the `OFFSET 999` prune index-walk is a bounded keep-window DELETE
      (`revision <= latest - limit`).
- [x] L9 — the redundant `chats` DELETE is dropped; the FK cascade (PRAGMA
      verified ON in the regression) removes the chat rows;
      `deleteCharacterRow` records the cascaded write for the metric budget.
- [x] L37 — the stray `console.log`s of full command/preset objects are gone.
- [x] L38 — the `console.log('Trigger time', ...)` per-render log is gone.
- [x] L39 — `findGeneratedAssistantMessage` scans the transcript in place.

## Behavior / Invariants

- M2 precondition held: module/script-resolution inputs are invariant across the
  per-message loop; only `data`/`chatRole`/`chatID` vary. The memo keys on the
  `presetRegex`/`customscript`/active-modules references and recomputes when a
  list is replaced.
- Assembly bytes, command-event retention, deleted rows, and rendered output are
  unchanged (each pinned by its regression).

## Done Criteria

- [x] M2/L3/L40: regexes/modules compiled once per assembly/pass (compile-count
      tests via a counting RegExp subclass); output identical.
- [x] L8: pruning no longer walks OFFSET-999 per write; retention unchanged for
      contiguous revisions (keep-window semantics pinned).
- [x] L9: character delete relies on the FK cascade; deleted rows and
      `writtenTables` unchanged.
- [x] L37/L38: no warm/render-path `console.log` of large objects remains
      (no-log spy tests).
- [x] L39: terminal lookup does not copy the transcript (booby-trapped
      `Symbol.iterator` proof).
- [x] Gates `M2, L3, L8, L9, L37, L38, L39, L40` registered in Phase 8.

## Regressions

- `server/fastify/__tests__/scripts.test.ts` — M2 block: 25-message window
  compiles each script regex once; cbs still per-message; replaced script list
  invalidates the memo; invalid precompile stays a per-script no-op.
- `server/fastify/__tests__/lorebook.test.ts` — L3 block: one compile per key
  across messages/passes/entries; malformed key parity.
- `server/fastify/__tests__/events.test.ts` — L8 keep-window test.
- `server/fastify/__tests__/repositoryWriterKit.test.ts` — L9 cascade test;
  `commandFloorUnblock.test.ts` keeps the end-to-end delete byte/metric parity.
- `src/ts/process/__tests__/command.projectionGuard.test.ts` — L37 no-log test.
- `src/ts/process/scripts.editdisplay.test.ts` — L38 display-pass no-log test.
- `src/ts/process/serverBackedSendChat.findMessage.test.ts` — L39 in-place
  scan tests.
- `src/ts/process/triggers.regexMemo.test.ts` — L40 per-pass compile counts on
  v2RegexTest / v2ReplaceString / extractRegex.

## Validation

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/scripts.test.ts server/fastify/__tests__/lorebook.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/repositoryWriterKit.test.ts`
- `pnpm exec vitest run src/ts/process`; `pnpm test`, `pnpm api:test`, both
  TypeScript checks.
