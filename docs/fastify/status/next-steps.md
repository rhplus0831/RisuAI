# Next Steps

Date: 2026-05-24

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

## Last Done

Phase 7 closeout passed. The server prompt assembly path is closed for
send, continue, regenerate, preview, and preview-prompt behind
`db.useServerPromptAssembly`; `/chat` SSE coverage pins prompt metadata,
`message_patch`, provider tokens, typed TTS side effects, restoration
errors, and enriched terminal `done` metadata.

## Immediate Pickup

Start Phase 8 with **8-1a-i - Migration runner + version bump**.

Expected scope:

- Add the first domain SQL migration path for `risu.db`.
- Keep `CURRENT_SCHEMA_VERSION` and the `schema_version` bootstrap row as
  the source of truth.
- Add a typed registry of ordered migration steps.
- Add `applyMigrations(db, fromVersion)` that runs each step in a single
  transaction and updates the existing `schema_version` row after a
  successful step.
- Add an idempotent reapply guard and tests proving migrations are
  runnable and reapply-safe.
- Bump the schema version for the runner framework only.

Out of scope for 8-1a-i:

- Memory tables, memory repositories, import/backfill, workers, routes,
  provider calls, SSE progress, prompt memory selection, and browser UI.

## Queue After 8-1a-i

1. 8-1a-ii - Memory tables on top of the runner.
2. 8-1b - Memory repositories + row mappers.
3. 8-1c - Legacy `hypaV3Data` import/backfill.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run the relevant focused tests while implementing, then before closing a
slice run:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after Phase 7 closeout: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 895 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and bundle-size warnings.

Focused Phase 7 closeout verification:

```bash
pnpm exec vitest run server/fastify/__tests__/generation.chat.test.ts --config server/fastify/vitest.config.ts
pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts src/ts/process/request/tests/serverMessagePatch.test.ts src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts
```

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Phase 7 closeout:
  [`../phases-completed/phase-7-prompt-assembly-closeout.md`](../phases-completed/phase-7-prompt-assembly-closeout.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Phase 7 archive through 7-12c:
  [`../phases-completed/phase-7-prompt-assembly-through-7-12c.md`](../phases-completed/phase-7-prompt-assembly-through-7-12c.md)
- 7-12d-i closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-i.md`](../phases-completed/phase-7-prompt-assembly-7-12d-i.md)
- 7-12d-ii closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-ii.md`](../phases-completed/phase-7-prompt-assembly-7-12d-ii.md)
- 7-12d-iii-a closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-iii-a.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iii-a.md)
- 7-12d-iii-b closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-iii-b.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iii-b.md)
- 7-12d-iv closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-iv.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iv.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
