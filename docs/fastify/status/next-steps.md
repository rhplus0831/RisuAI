# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-1 landed the Phase 9 command foundation. The slice added shared
Fastify command route plumbing, a rollback-safe `db.json` JSON mutation
helper with `baseRevision` / 409 handling, an in-process command event
catalog/sink, the typed browser command helper, and the harness command
`PATCH /api/v1/commands/settings/runtime` for the allowlisted
`useServerPromptAssembly` setting.

## Immediate Pickup

Continue Phase 9 implementation with **9-2a - Scalar settings groups**.

Expected scope:

- Extend `PATCH /api/v1/commands/settings/runtime` beyond the 9-1
  harness setting and add the remaining scalar settings groups from the
  command map: `providers`, `display`, `language`, `media`, `memory`,
  `advanced`, `sidebar`, and `account` as appropriate for scalar fields.
- Keep provider-key masking out of scope; placeholder/secret semantics
  wait for 9-6. Until then, provider settings commands may update the
  current unmasked fields directly.
- Replace server-backed web call sites for scalar settings with local
  draft state plus `src/ts/server/commands.ts` helpers. Tauri/local mode
  keeps existing local mutation paths.
- Preserve the 9-1 command contract: every command takes
  `baseRevision`, returns `{ revision, event }`, emits
  `settings.updated`, and returns 409
  `{ error: "revision_conflict", currentRevision }` on stale input.
- Cover representative allowlist validation, unknown keys, malformed
  payloads, auth, 409 conflict, rollback/no revision bump, bootstrap
  visibility, and browser helper behavior.

Out of scope for 9-2a:

- Bot preset lifecycle and preset apply/copy/select behavior.
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

## Queue After 9-2a

1. 9-2b - Bot presets.
2. 9-2c - Prompt templates/items.
3. 9-2d - Personas.
4. 9-2e - Translator presets.
5. 9-2f - Loadouts.
6. 9-3 - Characters, chats, messages.
7. 9-4 - Lorebooks, modules, plugins, assets.
8. 9-5 - Browser projection.
9. 9-6 - Storage and provider-key gating.
10. 9-7 - Server `.risu` codec core.
11. 9-8 - Import/export routes and bundle assets.
12. 9-9 - Full server-backed fixture sweep and closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused command/settings tests while building 9-2a, then before
closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-1: `pnpm check` clean,
`pnpm test` 657 tests plus 4 skipped, `pnpm api:test` 1056 tests, and
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
  [`../phases-completed/phase-9-client-thinning-9-1.md`](../phases-completed/phase-9-client-thinning-9-1.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
