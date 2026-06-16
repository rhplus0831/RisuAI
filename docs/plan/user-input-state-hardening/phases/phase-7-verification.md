# Phase 7: Verification

Status: pending.

Goal: prove the stale-state hardening workstream across shared helpers, domain
flows, browser interactions, and TypeScript checks.

## Scope

- Add or update focused tests for every behavior changed by Phases 1-6.
- Run a browser smoke pass for the highest-risk interactive flows that cannot
  be proven well in unit tests.
- Record any residual test gaps in `../status.md` before closing the
  workstream.
- Record final command output in `../latest-verification.md`.

## Required Coverage

- Operation tokens reject stale async callback results for changed targets.
- Narrow rollback skips when live state no longer equals the attempted value.
- Dirty projection preserves newer local draft fields while refreshing clean
  fields.
- Composer send/continue/file/translate paths do not clear or append into newer
  input.
- Reroll, partial edit, trigger, suggestion, and generation finalization verify
  the target chat/message after async boundaries.
- Character, settings, module, prompt icon, plugin, and theme/background upload
  or import callbacks check entity/run freshness.
- Collection rollback for presets/personas/loadouts/lore/scripts/modules/
  plugins/sidebar lists does not restore whole stale snapshots.
- Full resync/restore/import, memory job updates, and route hydration are
  fenced or intentionally destructive with proof.

## Browser Smoke Candidates

- Start `pnpm dev:agent`, open `http://localhost:6418`, and stop the dev server
  when done.
- Composer stale file flow: start file upload/paste, type newer text or switch
  chat, confirm late result does not modify the wrong composer.
- Character asset flow: start avatar/additional asset upload, switch character
  or edit asset list, confirm late result is rejected or scoped.
- Reroll flow: start reroll after hydration, switch chat, confirm no tail
  replacement lands on the new chat.
- Import/restore flow: start import/refresh, create a newer local edit, confirm
  the refresh is fenced or intentionally destructive.

## Validation Commands

Use the exact focused test list that exists after implementation. The final
closeout should include at minimum:

```bash
pnpm exec vitest run src/ts/server/commands.test.ts src/ts/chatCommands.test.ts
pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts \
  src/ts/process/request/tests/durableGeneration.test.ts \
  src/ts/process/rerollNavigation.test.ts \
  src/ts/process/files/multisend.test.ts \
  src/ts/characterCommands.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/commandSingleRowPaths.test.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/risuSaveImportRoute.test.ts \
  server/fastify/__tests__/risuSaveBundleImportRoute.test.ts \
  server/fastify/__tests__/realmImport.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

If a listed file is not relevant after implementation, replace it with the
nearest focused test and explain the swap in `../latest-verification.md`.

## Exit Criteria

- All required coverage has a passing focused test or an explicit tracked gap.
- Browser smoke either passes for the selected flows or the missing smoke gap is
  recorded with a reason.
- TypeScript workflow passes.
- `../status.md` records the workstream as complete or lists the remaining open
  phases and exact next steps.

## Risks

- Unit tests can miss UI lifetime bugs when component state is destroyed or
  selection changes mid-await. Browser smoke should target those gaps.
- A green server command suite does not prove client projection and rollback
  freshness. Keep client/store tests in the matrix.
