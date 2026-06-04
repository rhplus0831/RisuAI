# Memoization & Hygiene

Status: not started. Phase 7. Bundles the regex/compile memoization, redundant DB
work, and logging-hygiene items. Each is output/behavior preserving.

## Scope

Hoist invariant per-message/per-render work and memoize compiled regexes; drop
redundant deletes/scans; remove warm/render-path logging.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  **M2, L3, L8, L9, L37, L38, L39, L40**.
- `server/fastify/src/prompt/scripts.ts:316-356` (`processScript`, `applyOne`),
  `server/fastify/src/prompt/history.ts:299/:488-503` (M2),
  `server/fastify/src/prompt/lorebook.ts:245/:329-332` (L3).
- `server/fastify/src/commands/events.ts:140-156` (L8),
  `server/fastify/src/routes/commands.ts:2652-2653` + `repository.ts:253` FK (L9).
- `src/ts/process/command.ts:40/:43/:249`, `src/ts/storage/database.svelte.ts:2652`
  (L37), `src/ts/process/scripts.ts:168` (L38),
  `src/ts/process/serverBackedSendChat.ts:69-77` (L39),
  `src/ts/process/triggers.ts` (9 `new RegExp` sites) vs `scripts.ts:126-138`
  `getCompiledRegex` (L40).

## Item Checklist

- [ ] **M2** — hoist active-module resolution + `parseScripts` + the compiled
      RegExp list once per assembly into `formatHistoryMessage`; **exclude
      cbs-action scripts** (they pre-expand their source per message).
- [ ] **L3** — hoist/compile the lorebook keyword regexes outside the recursive
      activation loop **[known-leftover]**.
- [ ] **L40** — memoize the 9 trigger-effect `new RegExp` sites (reuse
      `getCompiledRegex`; reset `lastIndex` on retrieval).
- [ ] **L8** — replace the `OFFSET 999` prune index-walk with a bounded delete
      (keep-window by `revision`).
- [ ] **L9** — drop the redundant `chats` DELETE the FK cascade already performs
      (verify PRAGMA + FK active first).
- [ ] **L37** — remove the stray `console.log`s of full command/preset objects.
- [ ] **L38** — remove the `console.log('Trigger time', ...)` on the per-render
      `editdisplay` path.
- [ ] **L39** — scan the transcript in place in `findGeneratedAssistantMessage`
      instead of copying it.

## Behavior / Invariants

- M2 precondition: `processScript`'s module/script-resolution inputs are
  invariant across the per-message loop; only `data`/`chatRole`/`chatID` vary.
- Assembly output bytes, command-event retention, deleted-row sets, and rendered
  output are all unchanged.

## Done Criteria

- M2/L3/L40: regexes/modules compiled once per assembly/effect (compile-count
  test); output identical.
- L8: pruning no longer walks OFFSET-999 per write; retention unchanged.
- L9: character delete relies on the FK cascade; deleted rows unchanged.
- L37/L38: no warm/render-path `console.log` of large objects remains.
- L39: terminal lookup does not copy the transcript.
- Gates `M2, L3, L8, L9, L37, L38, L39, L40` registered in Phase 8.

## Validation

- `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts`
- `pnpm api:test -- server/fastify/__tests__/commandMetrics.test.ts server/fastify/__tests__/db.test.ts`
- `pnpm test -- src/ts/process`; `pnpm test`, `pnpm api:test`, both TypeScript
  checks.
