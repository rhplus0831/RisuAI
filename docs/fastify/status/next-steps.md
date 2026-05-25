# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-2a-ii landed the manual scalar settings page bridge. The slice added a
shared browser helper for grouped server-backed settings patches with
revision lookup, conflict retry, and rollback; registered Fastify-only
watchers for the named manual settings surfaces; extended the client and
server scalar maps for manual provider/runtime/media/account fields; and
covered representative command dispatch, rollback, conflict retry, and
local/Tauri no-dispatch behavior.

## Immediate Pickup

Continue Phase 9 implementation with
**9-2b - Bot presets**.

Expected scope:

- Add bot preset create/copy/update/delete/reorder/select/apply command
  coverage according to `phase-9-command-map.md`.
- Replace server-backed web preset helper flows in
  `src/lib/Setting/botpreset.svelte` and
  `src/ts/storage/database.svelte.ts` with typed commands while keeping
  Tauri/local mode on the existing mutation path.
- Preserve selected-preset behavior and explicit preset apply semantics;
  preset apply may touch scalar settings groups but should not reopen
  provider-key masking or prompt-template item work.
- Tauri/local mode keeps existing local mutation paths.
- Preserve the 9-1 command contract: every command takes
  `baseRevision`, returns `{ revision, event }`, emits
  the mapped preset event, and returns 409
  `{ error: "revision_conflict", currentRevision }` on stale input.
- Cover representative create/update/delete/reorder/select/apply flows,
  rollback/no-revision-bump on validation failure, conflict retry where
  applicable, and no command dispatch outside Fastify mode.

Out of scope for 9-2b:

- Prompt template/items and prompt-setting fields tied to template
  behavior.
- Personas, translator presets, and loadouts.
- Enforcing a read-only `DBState.db` guard.
- Bootstrap/event projection implementation.
- Server-side `.risu` import/export implementation.
- Provider-key masking or storage backend removal.

Implementation notes:

- Phase 9 is not a single "add commands" task. Treat command foundation,
  browser projection, storage gating, provider-key masking, and the
  server `.risu` codec as separate rollback surfaces.
- Build on the foundation in `server/fastify/src/commands/`,
  `server/fastify/src/routes/commands.ts`, and
  `src/ts/server/commands.ts`.
- Use the locked command map in
  [`phase-9-command-map.md`](phase-9-command-map.md) as the source of
  truth for command names, payload behavior, event names, and plugin
  bridge policy.
- Debounced re-bootstrap is the Phase 9 projection target. Per-event
  surgical patches are future work.
- Tauri keeps its local storage path. Phase 9 gates server-backed web
  behavior without changing local desktop storage mode.

## Queue After 9-2b

1. 9-2c - Prompt templates/items.
2. 9-2d - Personas.
3. 9-2e - Translator presets.
4. 9-2f - Loadouts.
5. 9-3 - Characters, chats, messages.
6. 9-4 - Lorebooks, modules, plugins, assets.
7. 9-5 - Browser projection.
8. 9-6 - Storage and provider-key gating.
9. 9-7 - Server `.risu` codec core.
10. 9-8 - Import/export routes and bundle assets.
11. 9-9 - Full server-backed fixture sweep and closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused command/preset tests while building 9-2b, then before
closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-2a-ii: `pnpm check` clean,
`pnpm test` 663 tests plus 4 skipped, `pnpm api:test` 1061 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

## References

- Active phase:
  [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md)
- Command map:
  [`phase-9-command-map.md`](phase-9-command-map.md)
- Closed memory phase:
  [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-9-client-thinning-9-2a-ii.md`](../phases-completed/phase-9-client-thinning-9-2a-ii.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
