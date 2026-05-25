# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-2c landed the prompt templates/items command bridge. The slice added
stable prompt item ids on server import and prompt UI mutation paths,
Fastify prompt settings plus prompt item create/update/delete/reorder
routes, typed browser prompt command helpers with revision lookup and one
conflict retry, and routed prompt template enablement plus prompt item and
prompt settings edits through commands in Fastify mode while keeping
local/Tauri mutation behavior intact.

## Immediate Pickup

Continue Phase 9 implementation with
**9-2d - Personas**.

Expected scope:

- Add persona create/update/delete/reorder/select command coverage
  according to `phase-9-command-map.md`.
- Replace server-backed web persona list, selected persona, and selected
  persona mirror-field mutation paths in `src/ts/persona.ts`,
  `src/lib/Setting/Pages/PersonaSettings.svelte`, `src/lib/Setting/listedPersona.svelte`,
  and related persona sidebars/helpers with typed commands while keeping
  Tauri/local mode on the existing mutation path.
- Preserve selected-persona mirror behavior for `username`, `userIcon`,
  `personaPrompt`, and `userNote` where the current product already
  updates those legacy profile fields.
- Do not reopen bot preset lifecycle, prompt templates/items, translator
  presets, or loadouts in this slice.
- Tauri/local mode keeps existing local mutation paths.
- Preserve the 9-1 command contract: every command takes
  `baseRevision`, returns `{ revision, event }`, emits
  the mapped persona event, and returns 409
  `{ error: "revision_conflict", currentRevision }` on stale input.
- Cover representative persona create/update/delete/reorder/select flows,
  mirror-field behavior, rollback/no-revision-bump on validation failure,
  conflict retry where applicable, and no command dispatch outside Fastify
  mode.

Out of scope for 9-2d:

- Bot preset lifecycle, selection, copy/import, and apply behavior.
- Prompt templates/items, translator presets, and loadouts.
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

## Queue After 9-2d

1. 9-2e - Translator presets.
2. 9-2f - Loadouts.
3. 9-3 - Characters, chats, messages.
4. 9-4 - Lorebooks, modules, plugins, assets.
5. 9-5 - Browser projection.
6. 9-6 - Storage and provider-key gating.
7. 9-7 - Server `.risu` codec core.
8. 9-8 - Import/export routes and bundle assets.
9. 9-9 - Full server-backed fixture sweep and closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused command/persona tests while building 9-2d, then before
closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-2c: `pnpm check` clean,
`pnpm test` 669 tests plus 4 skipped, `pnpm api:test` 1070 tests, and
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
  [`../phases-completed/phase-9-client-thinning-9-2c.md`](../phases-completed/phase-9-client-thinning-9-2c.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
