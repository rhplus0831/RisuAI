# Phase 7: Memoization & Hygiene

Status: COMPLETE. M2, L3, L8, L9, L37, L38, L39, L40 DONE (`151c6978`, one
batch). This was the last scheduled batch of the plan.

Goal: stop recomputing invariants in hot loops, drop redundant deletes/scans,
and remove warm-path `console.log`s. Behavior and output stay unchanged.

Findings: M2, L3, L8, L9, L37, L38, L39, L40.

## Source Anchors

- [`../audit-stability-and-performance.md`](../audit-stability-and-performance.md) -
  M2, L3, L8, L9, L37, L38, L39, L40.
- `server/fastify/src/prompt/scripts.ts` (`PreparedScript`, `prepareOne`,
  `getPreparedScripts` memo), `server/fastify/src/prompt/modules.ts`
  (`NO_ACTIVE_MODULES`), `server/fastify/src/prompt/lorebook.ts`
  (`getCompiledLoreKeyRegex`).
- `server/fastify/src/commands/events.ts` (`pruneCommandEventHistory`
  keep-window), `server/fastify/src/routes/commands.ts` (character delete),
  `server/fastify/src/repository.ts` (`deleteCharacterRow` FK cascade).
- `src/ts/process/command.ts`, `src/ts/storage/database.svelte.ts`
  (`downloadPreset`/`importPreset`), `src/ts/process/scripts.ts`
  (`processScriptFull` editdisplay), `src/ts/process/serverBackedSendChat.ts`
  (`findGeneratedAssistantMessage`), `src/ts/process/triggers.ts`
  (`getCompiledRegex` reuse).

## Slices

- [`memoization-and-hygiene.md`](slices/phase-7-memoization-and-hygiene/memoization-and-hygiene.md) -
  full batch, DONE (`151c6978`):
  - M2: `processScript` resolves modules + parses the script DSL + compiles
    each script's RegExp once per assembly via a `PreparedScript` list
    memoized per loaded `Database` (WeakMap; refs of
    `presetRegex`/`customscript`/active-modules guard staleness). cbs-action
    scripts keep per-message compiles (their source pre-expands per call).
  - L3: the lorebook keyword search compiles each `/pattern/flags` key once
    (bounded module-level memo, `lastIndex` reset on retrieval, malformed
    keys cache `null`) instead of per message × per key × per recursive pass.
  - L40: the 9 trigger-effect/condition `new RegExp` sites reuse the shared
    `getCompiledRegex` memo (per-pass reuse — a var-writing pass still
    resets the cache at its end via `ReloadGUIPointer`).
  - L8: `pruneCommandEventHistory` keeps a revision window ending at the
    just-persisted revision with one primary-key range DELETE (no
    `OFFSET 999` walk per write).
  - L9: character delete relies on the `chats.character_id ON DELETE CASCADE`
    (FK pragma verified ON); `deleteCharacterRow` records the cascaded
    `chats` write so the `writtenTables` metric stays truthful; the unused
    `deleteCharacterChats` helper is removed.
  - L37: the per-command `splited`/`pipe` dumps, the `test_lorebook` full
    report dump, and `downloadPreset`'s full preset log are removed; the
    completion audit caught `importPreset`'s remaining object dumps (the
    msgpack `decoded` envelope, the parsed `pre`, and the per-prompt ST-mapping
    `p`/'Prompt not found' logs), removed in the closeout —
    `src/ts/storage/database.svelte.ts` now has zero `console.log` calls.
  - L38: the per-render `console.log('Trigger time', ...)` is removed.
  - L39: `findGeneratedAssistantMessage` scans the transcript
    newest-to-oldest in place (no copy + reverse per terminal settle).

## Landed Shape Notes

- M2 went in as a memo inside `scripts.ts` (keyed per loaded `Database`)
  rather than an explicit parameter threaded through `formatHistoryMessage` —
  every `processScript` call site (history per-message walk, first message,
  editinput, editoutput) shares the prepared list without signature churn.
  `getActiveModules` returns a stable `NO_ACTIVE_MODULES` constant for the
  empty case so the memo can key on its result by reference.
- L40's memo lives within one trigger pass for setVar-style triggers: the
  pass bumps `ReloadGUIPointer` at its end, whose subscription calls
  `resetScriptCache()`. Display-mode passes (the per-render hot path) only
  write tempVars, so they keep the memo across renders.
- L8 keeps retention identical because every `bumpRevision` caller persists
  its event in the same transaction — the revision window equals the former
  keep-latest-N-rows walk. The keep-window semantics are themselves the
  regression proof (a gapped revision deletes below the window).
- L37 closed in two steps (completion-audit closeout): the batch removed the
  command/`downloadPreset` logs, the audit closeout removed `importPreset`'s
  four remaining dumps and added `database.importPreset.test.ts` — no-log spy
  proofs over a real `.risupreset` binary round-trip and an ST/json mapping
  that deliberately hits the unknown-identifier and missing-prompt branches,
  both registered as L37 `extraTests` in the Phase 8 gate.

## Exit Criteria

- [x] M2: one assembly resolves modules/scripts/regexes once, not per message
      (compile-count test via a counting RegExp subclass); assembly output bytes
      identical.
- [x] L3/L40: per-entry / per-effect regexes are compiled once and reused; output
      identical.
- [x] L8: command-event pruning does not walk OFFSET-999 per write; retention is
      unchanged.
- [x] L9: character delete relies on the FK cascade; no redundant DELETE; deleted
      rows unchanged.
- [x] L37/L38: no warm/render-path `console.log` of large objects remains.
- [x] L39: terminal assistant lookup does not copy the transcript.
- [x] Gates registered in Phase 8; full suites + audit + TypeScript checks green.

## Validation

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/scripts.test.ts server/fastify/__tests__/lorebook.test.ts` (M2, L3 compile-count).
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/repositoryWriterKit.test.ts` (L8, L9).
- `pnpm exec vitest run src/ts/process` (L37, L38, L39, L40).
- `pnpm test`, `pnpm api:test`, both TypeScript checks. See
  [`../latest-verification.md`](../latest-verification.md).
