# Phase 7: Memoization & Hygiene

Status: not started. The remaining mediums/lows: hoist invariant per-message/
per-render work, memoize compiled regexes, drop redundant DB work, and remove
stray render-path logging.

Goal: stop recompiling regexes and re-resolving invariants inside hot loops, drop
redundant deletes/scans, and remove warm-path `console.log`s. Each item is
output/behavior preserving.

Findings: **M2, L3, L8, L9, L37, L38, L39, L40**.

## Source Anchors

- [`../audit-stability-and-performance.md`](../audit-stability-and-performance.md) -
  M2, L3, L8, L9, L37, L38, L39, L40.
- `server/fastify/src/prompt/scripts.ts` (`processScript`, `applyOne` `new RegExp`),
  `server/fastify/src/prompt/history.ts` (per-message `formatHistoryMessage` loop),
  `server/fastify/src/prompt/lorebook.ts` (per-entry regex in the activation loop).
- `server/fastify/src/commands/events.ts` (`pruneCommandEventHistory` OFFSET walk),
  `server/fastify/src/routes/commands.ts` (character delete redundant `chats`
  DELETE), `server/fastify/src/repository.ts` (FK cascade).
- `src/ts/process/command.ts` (`console.log`), `src/ts/storage/database.svelte.ts`
  (`downloadPreset` log), `src/ts/process/scripts.ts` (`Trigger time` log),
  `src/ts/process/serverBackedSendChat.ts` (`findGeneratedAssistantMessage`
  transcript copy), `src/ts/process/triggers.ts` (9 `new RegExp` sites),
  `src/ts/process/scripts.ts` (`getCompiledRegex` precedent).

## Slices

- [`memoization-and-hygiene.md`](slices/phase-7-memoization-and-hygiene/memoization-and-hygiene.md) -
  the full batch:
  - M2: hoist active-module resolution + `parseScripts` + the compiled RegExp
    list once per assembly and thread it into `formatHistoryMessage`; exclude
    cbs-action scripts (which pre-expand their source per message).
  - L3: hoist/compile the lorebook keyword regexes outside the recursive
    activation loop **[known-leftover]**.
  - L40: memoize the 9 `new RegExp` trigger-effect sites (reuse the existing
    `getCompiledRegex`).
  - L8: replace the `OFFSET 999` prune index-walk with a bounded delete
    (keep-window by `revision`).
  - L9: drop the redundant `chats` DELETE the FK cascade already performs.
  - L37: remove the stray `console.log`s of full command/preset objects.
  - L38: remove the `console.log('Trigger time', ...)` on the per-render
    `editdisplay` path.
  - L39: scan the transcript in place in `findGeneratedAssistantMessage` instead
    of copying it.

## Planned Shape

- M2's precondition holds: `processScript`'s module/script-resolution inputs
  (`db`, `char`, `currentChat`) are invariant across the per-message loop; only
  `data`/`chatRole`/`chatID` vary. cbs-action scripts must be excluded from the
  precompiled list.
- L40 reuses the `getCompiledRegex(source, flags)` cache already in `scripts.ts`
  (reset `lastIndex` on retrieval).
- L8/L9 are pure DB-efficiency/correctness; FK cascade already deletes the chats,
  so the explicit DELETE is redundant (verify the PRAGMA + FK are active first).

## Exit Criteria

- [ ] M2: one assembly resolves modules/scripts/regexes once, not per message
      (load/compile-count test); assembly output bytes identical.
- [ ] L3/L40: per-entry / per-effect regexes are compiled once and reused; output
      identical.
- [ ] L8: command-event pruning does not walk OFFSET-999 per write; retention is
      unchanged.
- [ ] L9: character delete relies on the FK cascade; no redundant DELETE; deleted
      rows unchanged.
- [ ] L37/L38: no warm/render-path `console.log` of large objects remains.
- [ ] L39: terminal assistant lookup does not copy the transcript.
- [ ] Gates registered in Phase 8; full suites + audit + TypeScript checks green.

## Validation

- `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts`
  (M2, L3 compile-count).
- `pnpm api:test -- server/fastify/__tests__/commandMetrics.test.ts server/fastify/__tests__/db.test.ts`
  (L8, L9).
- `pnpm test -- src/ts/process` (L37, L38, L39, L40).
- `pnpm test`, `pnpm api:test`, both TypeScript checks.
