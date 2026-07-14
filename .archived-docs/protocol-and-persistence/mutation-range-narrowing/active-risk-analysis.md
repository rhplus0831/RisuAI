# Active Risk Analysis

Date: 2026-06-03

This file routes each mismatch tier: logical write, current physical write, and
target write. It is not a verification log. Keep proof runs in
[`latest-verification.md`](latest-verification.md), and keep per-route detail in
[`mutation-range-mismatch.md`](mutation-range-mismatch.md).

## Summary

All findings are analyzed. Phases 0-6 have landed: settings/plugin-storage
(`56ddd865`), single character/chat rows (`07971179`→`65e57c0a`), all eight
collection families (`2d35d161` closing Phase 4), the projection-resource
narrowing (`314af90f`, `f94e51ab`, `c3fff925`, `608de26c`), and the Tier-5
message-free ceiling (floors verified, Phase 6). Tier 5 is held at its safe floor
(`hydrated` where the message load is load-bearing, else `message-free`) with
blockers + unblock conditions recorded; its deeper narrowing is deferred. Severity
comes from the seed audit: 51 high, 18 medium, 3 low across 71 originally
over-broad routes.

| Tier / area | Current finding (actual write range) | Target write range | Phase / slice | Status |
| --- | --- | --- | --- | --- |
| Tier 1 — settings/pointer scalars | One settings scalar rewrote every character row + every chat row + all nine collection tables, and most also loaded every message (`hydrated`). 7 routes: characters/reorder, prompt-settings, plugins/provider, modules/enable, settings/:group, lorebooks/:id/select, translator-presets/select. | `UPDATE settings` only (six routes); translator-presets/select is settings + the `translator_presets` table. | [Phase 2 / settings-only](phases/slices/phase-2-settings-and-plugin-storage-paths/settings-only-mutation-paths.md) | Implemented (six routes in Phase 2; translator-presets/select in Phase 4) |
| Tier 2 — plugin custom storage | put/delete/bulk rewrite all characters + all chats + nine collection tables + settings + `plugin_custom_storage` (`message-free`). Written by plugins at runtime, so the waste recurs. | Single-key `UPSERT`/`DELETE` on `plugin_custom_storage` (bulk = clear + reinsert). | [Phase 2 / plugin-storage](phases/slices/phase-2-settings-and-plugin-storage-paths/plugin-storage-key-writers.md) | Implemented |
| Tier 3 — single character row | One character row (`data_json` holds folders/scripts/globalLore), most `hydrated` despite no messages. 9 routes incl. characters/:id PATCH, chat-folders CRUD/reorder, chats/reorder, per-character modules/reorder, chats/:id/fork. | One `characters` row (+ settings on trash; + that character's chat rows for folder-delete/reorder; + surgical messages on fork; per-character modules/reorder is character-row only). | [Phase 3 / single character row](phases/slices/phase-3-single-row-paths/single-character-row-paths.md) | Implemented |
| Tier 3 — single chat row | One chat row (`scriptstate`/`localLore` in `chats.data_json`). scriptstate was the hot hydrated path. | One `chats` row (+ parent character row only when `chatPage` moves on chat select). | [Phase 3 / single chat row](phases/slices/phase-3-single-row-paths/single-chat-row-paths.md) | Implemented |
| Tier 4 — single collection table | One element/ordering of one of nine tables rewrote all nine + all characters (+ messages on `hydrated`). Eight families, ~37 routes. | The one collection table (single-row `WHERE position=?` for pure field edits; one-table rewrite for create/delete/reorder), + the family's pointer scalar in settings. | [Phase 4](phases/phase-4-collection-table-paths.md) (one slice per family) | Implemented |
| Tier 5 — blocked deeper narrowing | Cross-table spans or load-bearing message/normalization dependencies block a per-row write. 9 routes: characters create / create-and-select / DELETE, characters/:id/chats create, chats/:id DELETE, modules create / DELETE, characters/:id scripts/triggers. | Safe floor only: `hydrated` for the two deletes (orphan message cleanup) + chats-create (corpus-wide validation), else `message-free`; deeper narrowing deferred until the blocker is scoped. | [Phase 6](phases/phase-6-message-free-ceiling.md) | Implemented (floors verified; `DELETE chats/:id` floor corrected to `hydrated`) |
| Projection — broad resources | `character`, `chat`/`chatFolder`/`message`/`generation`, `lorebook`, `module`, `scriptDefinition`/`triggerDefinition` originally re-shipped whole stubbed arrays on a foreign/recovery refresh. | Narrow per-row/per-resource branches: `characterRow`, `generation-chat`, module-scoped resources, and `globalLorebook` / `characterLorebook`. | [Phase 5 / projection branches + lorebook split](phases/phase-5-projection-range-narrowing.md) | Implemented |
| Projection — field bugs | `prompt`/`promptItem` shipped `['botPresets']`; `persona` omitted the legacy mirror scalars; `loadout` omitted `lastLoadedLoadoutName`. | `prompt` falls back to full/sprawling; `promptItem` ships `['promptTemplate']`; `persona` includes mirror scalars; `loadout` includes `lastLoadedLoadoutName`. | [Phase 5 / field bugs](phases/slices/phase-5-projection-range-narrowing/projection-field-bug-fixes.md) | Implemented |

## Source Anchors

- Routes and helpers: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`.
- Writers and table split: `server/fastify/src/repository.ts`.
- Projection: `server/fastify/src/routes/projection.ts`,
  `src/ts/server/projection.ts`, `src/ts/bootstrap.ts`.
- Metric harness and rowid-stability template:
  `server/fastify/__tests__/commandMetrics.test.ts`,
  `server/fastify/__tests__/commands.test.ts` (`tableRowidsById`).

## Decision

Keep the implemented tiers as regression-protected baseline. Tier 5 is held at
its safe floor (verified in Phase 6); the remaining runtime decision is the
deferred unblock work — a slice that proves the needed targeted message delete,
corpus-wide validation replacement, or normalization scoping before any Tier-5
route narrows below its floor.

- Tier 1-4 write narrowing is implemented; use the phase docs for current route
  behavior and the seed audit only for the before-state.
- Phase 5 projection narrowing is implemented; broad fallbacks now remain only
  where the write is truly broad or the resource is intentionally sprawling.
- Phase 6 is implemented (floors verified); Phase 7 is the next focus as the
  verification-maintenance layer, with the Tier-5 unblock prerequisites available
  as optional gated follow-ups.

## Non-Goals

- Do not scope the global normalization passes into validate-only helpers as part
  of a write-range slice; that is the Phase 6 unblock prerequisite, tracked
  separately.
- Do not narrow `settings`, `state`, or `pluginStorage` projection (sprawling by
  design); narrowing their writes is still correct but yields no projection win.
- Do not change message-store, `hypaV3Data`, or alternate semantics.
- Do not treat a `message-free` downgrade as the final fix for a route the audit
  marks reachable to a per-row write.
