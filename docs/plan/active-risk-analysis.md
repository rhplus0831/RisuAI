# Active Risk Analysis

Date: 2026-06-03

This file routes each mismatch tier: logical write, current physical write, and
target write. It is not a verification log. Keep proof runs in
[`latest-verification.md`](latest-verification.md), and keep per-route detail in
[`mutation-range-mismatch.md`](mutation-range-mismatch.md).

## Summary

All findings are analyzed. Tier 1 and Tier 2 are implemented (Phase 2,
`56ddd865`); Tiers 3-5 remain planned. Each tier maps to a phase slice. Severity
comes from the verified audit: 51 high, 18 medium, 3 low across 71 over-broad
routes.

| Tier / area | Current finding (actual write range) | Target write range | Phase / slice | Status |
| --- | --- | --- | --- | --- |
| Tier 1 — settings/pointer scalars | One settings scalar rewrites every character row + every chat row + all nine collection tables, and most also load every message (`hydrated`). 7 routes: characters/reorder, prompt-settings, plugins/provider, modules/enable, settings/:group, lorebooks/:id/select, translator-presets/select. | `UPDATE settings` only (six routes); translator-presets/select is settings + the `translator_presets` table. | [Phase 2 / settings-only](phases/slices/phase-2-settings-and-plugin-storage-paths/settings-only-mutation-paths.md) | Implemented (six routes; translator-presets/select deferred to Phase 4) |
| Tier 2 — plugin custom storage | put/delete/bulk rewrite all characters + all chats + nine collection tables + settings + `plugin_custom_storage` (`message-free`). Written by plugins at runtime, so the waste recurs. | Single-key `UPSERT`/`DELETE` on `plugin_custom_storage` (bulk = clear + reinsert). | [Phase 2 / plugin-storage](phases/slices/phase-2-settings-and-plugin-storage-paths/plugin-storage-key-writers.md) | Implemented |
| Tier 3 — single character row | One character row (`data_json` holds folders/scripts/globalLore), most `hydrated` despite no messages. 9 routes incl. characters/:id PATCH, chat-folders CRUD/reorder, chats/reorder, per-character modules/reorder, chats/:id/fork. | One `characters` row (+ settings on trash; + that character's chat rows for folder-delete/reorder; + modules table on modules/reorder; + surgical messages on fork). | [Phase 3 / single character row](phases/slices/phase-3-single-row-paths/single-character-row-paths.md) | Planned |
| Tier 3 — single chat row | One chat row (`scriptstate`/`localLore` in `chats.data_json`). scriptstate (`2983`, `hydrated`) is hot (script/generation runtime). | One `chats` row (+ parent character row when `chatPage` moves or when keeping `normalizeAllCharacterChats` repairs). | [Phase 3 / single chat row](phases/slices/phase-3-single-row-paths/single-chat-row-paths.md) | Planned |
| Tier 4 — single collection table | One element/ordering of one of nine tables rewrites all nine + all characters (+ messages on `hydrated`). Eight families, ~37 routes. | The one collection table (single-row `WHERE position=?` for pure field edits; one-table rewrite for create/delete/reorder), + the family's pointer scalar in settings. | [Phase 4](phases/phase-4-collection-table-paths.md) (one slice per family) | Planned |
| Tier 5 — blocked deeper narrowing | Cross-table spans or load-bearing message/normalization dependencies block a per-row write. 8 routes: characters create / create-and-select / DELETE, characters/:id/chats create, chats/:id DELETE, modules/:id DELETE, characters/:id scripts/triggers. | `message-free` floor only, until the blocker is scoped. | [Phase 6](phases/phase-6-message-free-ceiling.md) | Planned |
| Projection — broad resources | `character`, `chat`/`chatFolder`/`message`/`generation`, `lorebook`, `module`, `scriptDefinition`/`triggerDefinition` re-ship whole stubbed arrays on a foreign/recovery refresh. | Narrow per-row/per-resource branches (templates: `characterSelection`/`characterLorebook`); split `lorebook` into a `globalLorebook` resource. | [Phase 5 / projection branches + lorebook split](phases/phase-5-projection-range-narrowing.md) | Planned |
| Projection — field bugs | `prompt`/`promptItem` ship `['botPresets']` (never reflect the changed fields); `persona` omits the legacy mirror scalars; `loadout` omits `lastLoadedLoadoutName`. Broken today, independent of write range. | `prompt` falls back to full/sprawling; `promptItem` ships `['promptTemplate']`; `persona` += mirror scalars; `loadout` += `lastLoadedLoadoutName`. | [Phase 5 / field bugs](phases/slices/phase-5-projection-range-narrowing/projection-field-bug-fixes.md) | Planned |

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

Order the work by write amplification, call frequency, and fix clarity. Phase 0
adds the writer kit and gates, so later slices can prove they stopped rewriting
unrelated rows. Phase 1 is the safe stopgap: it removes the all-message load and
chat-row rewrite from ~62 routes, but it is not the final fix for routes that can
reach a per-row write.

- Settings/pointer (Tier 1): cleanest, highest ratio. Note the translator table
  write, the `moduleEnabled` projection, and the lorebook normalization drop.
- Plugin storage (Tier 2): standalone runtime table. No projection win, but real
  recurring write savings.
- Single rows (Tier 3): safe to narrow before projection because refresh reads
  SQLite fresh. Prioritize hot `scriptstate`.
- Collections (Tier 4): start with plugins; its projection is already narrow.
  Other families need pointer co-writes and projection-field fixes.
- Projection (Phase 5): secondary to writes, but still required. The three field
  bugs are wrong today.

## Non-Goals

- Do not scope the global normalization passes into validate-only helpers as part
  of a write-range slice; that is the Phase 6 unblock prerequisite, tracked
  separately.
- Do not narrow `settings`, `state`, or `pluginStorage` projection (sprawling by
  design); narrowing their writes is still correct but yields no projection win.
- Do not change message-store, `hypaV3Data`, or alternate semantics.
- Do not treat a `message-free` downgrade as the final fix for a route the audit
  marks reachable to a per-row write.
