# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-0 locked the Phase 9 mutation inventory and command map. The slice
classified the durable browser write surfaces, command families,
id-vs-index policy, child replacement semantics, reorder behavior,
revision conflict contract, event naming rules, plugin database bridge,
and implementation slice ownership.

## Immediate Pickup

Start Phase 9 implementation with **9-1 - Command foundation**.

Expected scope:

- Add shared Fastify command route plumbing under `/api/v1/commands/*`.
- Add a repository mutation helper that loads the current `db.json`
  blob, validates `baseRevision`, applies exactly one JSON mutation,
  bumps the schema revision once on success, and rolls back on
  validation or thrown errors.
- Add the initial command event catalog/sink used by command responses;
  exposing it over SSE waits for 9-5.
- Add a typed browser helper under `src/ts/server/commands.ts`.
- Ship one small allowlisted settings command,
  `PATCH /api/v1/commands/settings/runtime`, as the harness command.
- Cover auth, missing/invalid `baseRevision`, 409 conflict,
  success/bootstrap visibility, rollback, event shape, and browser helper
  behavior.

Out of scope for 9-1:

- Broad resource command families beyond the one settings harness.
- Replacing existing UI mutation call sites.
- Enforcing a read-only `DBState.db` guard.
- Bootstrap/event projection implementation.
- Server-side `.risu` import/export implementation.
- Provider-key masking or storage backend removal.

Implementation notes:

- Phase 9 is not a single "add commands" task. Treat command foundation,
  browser projection, storage gating, provider-key masking, and the
  server `.risu` codec as separate rollback surfaces.
- Use the locked command map in
  [`phase-9-command-map.md`](phase-9-command-map.md) as the source of
  truth for command names, payload behavior, event names, and plugin
  bridge policy.
- Debounced re-bootstrap is the Phase 9 projection target. Per-event
  surgical patches are future work.
- Tauri keeps its local storage path. Phase 9 gates server-backed web
  behavior without changing local desktop storage mode.

## Queue After 9-1

1. 9-2 - Settings, presets, personas, loadouts.
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

Run focused command foundation tests while building 9-1, then before
closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-0: `pnpm check` clean,
`pnpm test` 652 tests plus 4 skipped, `pnpm api:test` 1050 tests, and
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
  [`../phases-completed/phase-9-client-thinning-9-0.md`](../phases-completed/phase-9-client-thinning-9-0.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
