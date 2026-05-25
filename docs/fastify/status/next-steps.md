# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-2d landed the personas command bridge. The slice added persona command
validation and id normalization, Fastify persona create/update/delete/
select/reorder routes, typed browser persona command helpers with
revision lookup and one conflict retry, and routed server-backed persona
selection, settings-page create/delete/reorder, import create, image/profile
mirror updates, and selected profile-field edits through commands in
Fastify mode while keeping local/Tauri mutation behavior intact.

## Immediate Pickup

Continue Phase 9 implementation with
**9-2e - Translator presets**.

Expected scope:

- Add translator preset create/update/delete/select command coverage
  according to `phase-9-command-map.md`.
- Replace server-backed web translator preset list, selected translator
  preset, and any current legacy-field sync paths in translator preset UI
  and helpers with typed commands while keeping Tauri/local mode on the
  existing mutation path.
- Preserve current translator preset selection behavior and runtime-field
  sync where the product already performs it.
- Do not reopen bot preset lifecycle, prompt templates/items, personas, or
  loadouts in this slice.
- Tauri/local mode keeps existing local mutation paths.
- Preserve the 9-1 command contract: every command takes
  `baseRevision`, returns `{ revision, event }`, emits
  the mapped translator preset event, and returns 409
  `{ error: "revision_conflict", currentRevision }` on stale input.
- Cover representative translator preset create/update/delete/select
  flows, legacy-field sync behavior, rollback/no-revision-bump on
  validation failure, conflict retry where applicable, and no command
  dispatch outside Fastify mode.

Out of scope for 9-2e:

- Bot preset lifecycle, selection, copy/import, and apply behavior.
- Prompt templates/items, personas, and loadouts.
- Runtime translation request dispatch.
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

## Queue After 9-2e

1. 9-2f - Loadouts.
2. 9-3 - Characters, chats, messages.
3. 9-4 - Lorebooks, modules, plugins, assets.
4. 9-5 - Browser projection.
5. 9-6 - Storage and provider-key gating.
6. 9-7 - Server `.risu` codec core.
7. 9-8 - Import/export routes and bundle assets.
8. 9-9 - Full server-backed fixture sweep and closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused command/translator preset tests while building 9-2e, then
before closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-2d: `pnpm check` clean,
`pnpm test` 671 tests plus 4 skipped, `pnpm api:test` 1074 tests, and
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
  [`../phases-completed/phase-9-client-thinning-9-2d.md`](../phases-completed/phase-9-client-thinning-9-2d.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
