# Phase 7 Completion Audit

Date: 2026-06-05 (closeout applied same day — see the blocking finding's
resolution)

Scope: Active Phase 7 memoization and hygiene workstream in
`docs/plan/phases/phase-7-memoization-and-hygiene.md`, covering M2, L3, L8,
L9, L37, L38, L39, L40, and the Phase 8 gate registration.

## Verdict

CLOSED. Phase 7 is complete.

The original audit verdict was "not fully complete": most Phase 7
implementation claims were real and verified — M2, L3, L8, L9, L38, L39, and
L40 implemented with regression coverage, focused/full suites green — but L37
was only half done. The command warm-path logs were removed, while
preset/import object logging still existed in
`src/ts/storage/database.svelte.ts`, and the Phase 8 gate registered only the
command-path regression. The blocking finding has since been closed; its
section below records the resolution.

## Blocking Finding

### L37: preset/import object logs remain — CLOSED

The original finding is "Stray `console.log` of full command/preset objects on
warm paths" and cites both `src/ts/process/command.ts` and
`src/ts/storage/database.svelte.ts` in
`docs/plan/audit-stability-and-performance.md`.

Command processing is fixed: `processMultiCommand` no longer logs the split
commands or pipe values, and
`src/ts/process/__tests__/command.projectionGuard.test.ts` asserts the command
warm path writes nothing to `console.log`.

The preset/import half is still open. These logs remain:

- `src/ts/storage/database.svelte.ts:2712` logs `decoded`.
- `src/ts/storage/database.svelte.ts:2723` logs `pre`.
- `src/ts/storage/database.svelte.ts:2824` logs `p`.
- `src/ts/storage/database.svelte.ts:2834` logs `Prompt not found`, including
  the prompt object.

The Phase 8 registry entry for L37 says "Remove logs of full command/preset
objects", but its only registered proof is the command-processing test:
`src/ts/__tests__/fixCompletenessGate.test.ts` points L37 at
`src/ts/process/__tests__/command.projectionGuard.test.ts` with test name
"L37: command processing logs nothing to console.log on the warm path".

Recommended closeout:

- Remove or gate the remaining preset/import `console.log` calls.
- Add a regression for the preset/import path that spies on `console.log`.
- Register that regression under L37 as an `extraTests` proof in the Phase 8
  gate.
- Then flip this audit verdict to CLOSED or add a closeout section mirroring the
  Phase 4/Phase 6 completion-audit pattern.

Resolution (2026-06-05): implemented as recommended — all three halves.

- All four remaining `importPreset` log sites were removed: the msgpack
  `decoded` envelope dump on the `.risupreset`/`.risup` path, the parsed `pre`
  dump on the JSON path, and the per-prompt ST-mapping dumps (`console.log(p)`
  in the unknown-identifier default case and `'Prompt not found'` for order
  entries with no matching prompt). `src/ts/storage/database.svelte.ts` now
  contains zero `console.log` calls.
- Regression added: `src/ts/storage/database.importPreset.test.ts` spies on
  `console.log` across both import shapes — a real `.risupreset` binary built
  exactly like `downloadPreset` builds one (msgpack + AES-GCM encrypt +
  deflate), and an ST/json preset whose order deliberately includes an
  unknown-identifier prompt and a missing prompt so all three former JSON-side
  log sites are on the executed path. Both tests also prove the import landed
  (preset row appended, ST prompt rows mapped, `/presets/import` command
  dispatched) so the silence assertion is non-vacuous. Verified to fail
  against temporarily reinstated logs on both paths (`expected "log" to not be
  called`), proving it covers the audited gap.
- Gate registered: the L37 entry in
  `src/ts/__tests__/fixCompletenessGate.test.ts` now lists both preset-import
  tests as `extraTests` proofs alongside the command-path regression.

## Satisfied Items

### M2: hoist module/script/RegExp work once per assembly

Implemented. Server-side `processScript` uses a `WeakMap` prepared-script memo
keyed by loaded `Database`; `prepareOne` precomputes flags, replacement
templates, move classification, and non-CBS `RegExp` instances. CBS scripts
still compile per call because their source pre-expands per message.

Evidence:

- `server/fastify/src/prompt/scripts.ts:273`
- `server/fastify/src/prompt/scripts.ts:404`
- `server/fastify/src/prompt/scripts.ts:445`
- `server/fastify/src/prompt/modules.ts:55`
- `server/fastify/__tests__/scripts.test.ts:848`

### L3: memoize lorebook keyword regexes

Implemented. Lorebook regex-form keys use a bounded cache, reset `lastIndex` on
retrieval, and cache malformed keys as `null` to preserve deactivate-without-
throw behavior.

Evidence:

- `server/fastify/src/prompt/lorebook.ts:189`
- `server/fastify/src/prompt/lorebook.ts:272`
- `server/fastify/__tests__/lorebook.test.ts:1416`

### L8: replace OFFSET prune walk with bounded delete

Implemented. `persistCommandEvent` prunes command-event history with a single
revision range delete after inserting the event.

Evidence:

- `server/fastify/src/commands/events.ts:89`
- `server/fastify/src/commands/events.ts:162`
- `server/fastify/src/commands/events.ts:170`
- `server/fastify/__tests__/events.test.ts:263`

### L9: drop redundant character-wide chats DELETE

Implemented. Character deletion relies on `chats.character_id ON DELETE CASCADE`
when `deleteCharacterRow` deletes the character row. The route still separately
removes message and Hypa rows for the deleted chats.

Evidence:

- `server/fastify/src/routes/commands.ts:2651`
- `server/fastify/src/repository.ts:474`
- `server/fastify/__tests__/repositoryWriterKit.test.ts:262`
- `server/fastify/__tests__/commandFloorUnblock.test.ts:410`

### L38: remove per-render Trigger time log

Implemented for the scoped render path. `processScriptFull(..., 'editdisplay')`
no longer writes `console.log('Trigger time', ...)`, and the display-render
regression spies on `console.log`.

Evidence:

- `src/ts/process/scripts.ts:156`
- `src/ts/process/scripts.editdisplay.test.ts:95`

Note: a separate literal `Trigger time` remains outside this scoped render path
in `src/ts/process/request/request.ts`.

### L39: scan transcript in place

Implemented. `findGeneratedAssistantMessage` checks direct `chatId` first, then
scans newest-to-oldest by index without copying/reversing the transcript.

Evidence:

- `src/ts/process/serverBackedSendChat.ts:70`
- `src/ts/process/serverBackedSendChat.findMessage.test.ts:26`

### L40: memoize trigger-effect regex sites

Implemented. `src/ts/process/triggers.ts` has no runtime `new RegExp` sites in
the trigger effect paths; scoped regex work goes through `getCompiledRegex`,
which resets `lastIndex` and uses a bounded cache.

Evidence:

- `src/ts/process/triggers.ts:1516`
- `src/ts/process/triggers.ts:1729`
- `src/ts/process/triggers.ts:3365`
- `src/ts/process/scripts.ts:126`
- `src/ts/process/triggers.regexMemo.test.ts:135`

Coverage note: L40 tests are representative rather than exhaustive across every
changed trigger site, but static inspection confirms no raw runtime
`new RegExp` remains in `src/ts/process/triggers.ts`.

## Subagent Cross-Check

Two subagents independently audited the split scope:

- Server-side M2/L3/L8/L9: no incomplete claims found.
- Client-side L37/L38/L39/L40: found the same L37 preset/import logging gap;
  L38, L39, and L40 checked out.

## Validation

Current audit run:

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/scripts.test.ts server/fastify/__tests__/lorebook.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/repositoryWriterKit.test.ts`
  passed: 4 files, 142 tests.
- `pnpm exec vitest run src/ts/process/__tests__/command.projectionGuard.test.ts src/ts/process/scripts.editdisplay.test.ts src/ts/process/serverBackedSendChat.findMessage.test.ts src/ts/process/triggers.regexMemo.test.ts src/ts/process/scripts.regexCache.test.ts src/ts/__tests__/fixCompletenessGate.test.ts`
  passed: 6 files, 28 tests.
- `pnpm api:test` passed: 99 files, 1737 passed, 1 skipped.
- `pnpm test` passed: 121 files, 1130 passed, 4 skipped. The run emitted the
  known `127.0.0.1:3000` connection-refused noise but did not fail.
- `pnpm exec tsc -p tsconfig.client-lib.json` passed.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit` passed.
- `pnpm client-thinning:audit` passed.

## Closeout Validation (2026-06-05)

- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts
  src/ts/process/__tests__/command.projectionGuard.test.ts
  src/ts/storage/database.importPreset.test.ts`

  Result: 3 test files passed, 18 tests passed (gate validates the two new
  L37 `extraTests` proofs alongside the command-path regression).

- The new regressions run against temporarily reinstated logs
  (`console.log(decoded)` on the binary path, `console.log(p)` on the ST
  path): both fail at the silence assertion (`expected "log" to not be called
  at all, but actually been called 1 times`), proving they cover the audited
  gap.

- `rg -n "console\.log" src/ts/storage/database.svelte.ts`: zero matches.

- `pnpm test` passed: 122 files, 1132 passed, 4 skipped (+1 file / +2 tests
  over the audit run's 121/1130).

- `pnpm exec tsc -p tsconfig.client-lib.json` and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`

  Result: zero errors.

- `pnpm client-thinning:audit` passed.
