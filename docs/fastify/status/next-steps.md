# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

8-9 closed Phase 8. The final pass verified the full matrix, confirmed
the Hypa V3 memory exit criteria, archived the closeout notes, and moved
the live handoff to Phase 9 client thinning.

## Immediate Pickup

Start Phase 9 with **9-0 - Mutation inventory and command map**.

Expected scope:

- Inventory direct durable mutation sites in `src/lib/` and `src/ts/`,
  including `DBState.db` writes, `setDatabase` / `setDatabaseLite`,
  plugin database setters, storage helpers, and helper APIs that mutate
  through indirection.
- Classify each write site by resource family, server-backed web scope,
  local/Tauri-only scope, rollback risk, and owning Phase 9 slice.
- Lock command endpoint names, payload shapes, id-vs-index behavior,
  child replacement behavior, reorder semantics, revision conflict
  behavior, event names, and test expectations before implementation.
- Record the plugin-write translation bridge: keep the plugin-facing API,
  map allowed top-level keys to typed commands, and route unknown plugin
  keys to `pluginCustomStorage` when implementation lands later.
- Update the live Phase 9 docs with the command map and the next concrete
  implementation pickup.

Out of scope for 9-0:

- Adding command routes or browser command helpers.
- Enforcing a read-only `DBState.db` guard.
- Replacing mutation call sites.
- Bootstrap/event projection implementation.
- Server-side `.risu` import/export implementation.
- Provider-key masking or storage backend removal.

Implementation notes:

- Phase 9 is not a single "add commands" task. Treat command design,
  browser projection, storage gating, provider-key masking, and the
  server `.risu` codec as separate rollback surfaces.
- Include mutation paths that bypass property-level grep, especially
  `setDatabase`, `setDatabaseLite`, plugin database setters, import /
  restore flows, and helper functions that receive mutable references.
- Debounced re-bootstrap is the Phase 9 projection target. Per-event
  surgical patches are future work.
- Tauri keeps its local storage path. Phase 9 gates server-backed web
  behavior without changing local desktop storage mode.

## Queue After 9-0

1. 9-1 - Command foundation.
2. 9-2 - Settings, presets, personas, loadouts.
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

Run relevant grep/audit commands while building the inventory, then
before closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 8-9: `pnpm check` clean,
`pnpm test` 652 tests plus 4 skipped, `pnpm api:test` 1050 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Latest Phase 8 closeout verification passed on 2026-05-25.

## References

- Active phase:
  [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md)
- Closed memory phase:
  [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-9.md`](../phases-completed/phase-8-memory-8-9.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
