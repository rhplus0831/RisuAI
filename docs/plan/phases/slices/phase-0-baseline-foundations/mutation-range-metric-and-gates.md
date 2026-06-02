# Mutation-Range Metric And Review Gates

Status: implemented (2026-06-03). The first Phase 0 slice — it captures the
before-state and the reusable gate template.

## Source Anchors

- `server/fastify/__tests__/commandMetrics.test.ts` - the `command_mutation`
  metric shape, the `mutationPath` review gate map, and the `dbJsonWriteMs`
  checks (~32, ~46-56, ~324-339).
- `server/fastify/__tests__/commands.test.ts` - `tableRowidsById` (~161,
  ~3269-3284) and `activeMessageRowids` (~150).
- `server/fastify/src/protocolMetrics.ts` - the metric record.

## Scope

The existing `command_mutation` metric records `mutationPath`, `loadMs`,
`cloneMutateMs`, `sqliteSyncMs`, `dbJsonWriteMs`, and `totalMs` — timing, not
which tables a route physically wrote. Add the written-table dimension so "the
write narrowed" becomes a checkable claim: record the set of tables a command
actually wrote (characters / chats / each of the nine collection tables /
settings / plugin_custom_storage / message store), so a before/after table-set
diff is the proof.

Then capture the over-broad baseline for the 71 routes against the existing
message-heavy harness (12 characters, 8 chats/character, 40 messages/chat) and
record it here, and generalize the reference fix's rowid-stability +
`dbJsonWriteMs: 0` checks into a reusable review-gate template.

## Implementation Scope

- Source files (as landed):
  - `server/fastify/src/protocolMetrics.ts` — `beginTableWriteCapture` /
    `recordTableWrite` / `takeTableWrites` plus the `writtenTables` field. A
    command mutation is one synchronous `BEGIN IMMEDIATE` transaction, so a single
    module-level recorder captures the physical table writes; capture is armed
    only when metrics are enabled (one null check per write otherwise).
  - `server/fastify/src/repository.ts` — the broad `replaceAll*` writers and
    `writeCharacterSelectionRows` call `recordTableWrite` at each write boundary.
  - `server/fastify/src/messageStore.ts` — message-store writers report
    `messages` / `chat_hypa_v3` at each write statement (no-op functions like an
    unchanged `applyChatMessageDiff` record nothing).
  - `server/fastify/src/commands/mutations.ts` — all four helpers open a capture
    and emit `writtenTables` on the `command_mutation` metric.
  - `server/fastify/__tests__/helpers/commandMetricGates.ts` — the importable
    review-gate template (`COMMAND_METRIC_REVIEW_GATES`, `BROAD_WRITE_TABLES`,
    `assertCommandMetricGate`, `commandMetricReviewGate`).
  - `server/fastify/__tests__/helpers/rowStability.ts` — the importable
    `tableRowidsById` / `activeMessageRowids` rowid-stability primitives, reused
    by `commands.test.ts`.
  - `server/fastify/__tests__/commandMetrics.test.ts` — imports the gate template
    and asserts the `writtenTables` baseline.
- The written-table set is captured at the write boundary (the broad
  `replaceAll*` and the kit writers both report which tables they touched), so the
  metric is truthful for both broad and narrow paths. Protocol bookkeeping tables
  (`schema_version`, `command_events`) are intentionally not recorded — they are
  written by every mutation and would be noise.
- The review-gate template exposes: a per-`mutationPath` expected table set
  (`expectedTables` exact / `maxTables` subset / `forbiddenTables` disjoint), the
  `dbJsonWriteMs: 0` assertion for targeted paths, and the `tableRowidsById` /
  `activeMessageRowids` stability primitives for the unrelated rows.
- Non-scope: changing any route's write range; this slice only measures and gates.

## Protocol Behavior

- The metric is opt-in (gated behind the existing `RISU_PROTOCOL_METRICS` /
  `RISU_COMMAND_METRIC_SUMMARY` flags); no runtime behavior changes.

## Done When

- [x] `command_mutation` records the written-table set, verified for a broad path
  (`message-free` → 13 tables) and a targeted path (`character.selected` →
  `{characters, settings}`).
- [x] The before-state table sets for the 71 over-broad routes are recorded (the
  Measurement table above, keyed by route family; the route→family map lives in
  the seed audit).
- [x] The review-gate template is importable
  (`__tests__/helpers/commandMetricGates.ts`) and the existing
  `targeted-character-selection` gate runs through it without behavior change.

## Measurement

Captured before-state (2026-06-03), expressed in physical SQLite table names so
the metric is a literal write proof. The broad write set is the 13 tables every
`replaceAll*` mutation rewrites for any single sub-row change:

```
bot_presets, characters, chats, hypa_v3_presets, loadouts, lore_books,
modules, personas, plugin_custom_storage, plugins, prompt_templates,
settings, translator_presets
```

This set is `BROAD_WRITE_TABLES` in `commandMetricGates.ts`. Per route family:

| `mutationPath` | Routes | `writtenTables` (physical) |
| --- | --- | --- |
| `message-free` | 5 of the 71 over-broad routes | the 13 `BROAD_WRITE_TABLES` exactly |
| `hydrated` | 66 of the 71 over-broad routes | the 13 `BROAD_WRITE_TABLES`, plus `messages` / `chat_hypa_v3` only when a message actually changed (most never do); the defining waste is the all-message *load* (`loadMs`) + the 13-table rewrite |
| `targeted-character-selection` (reference fix) | `characters/select` | `{characters, settings}` |
| `targeted-message` | the 5 message commands | `{messages}` |
| `targeted-generation` | `generation.persisted` | `{messages}` |

The per-route family mapping for the 71 over-broad routes (which route is on
`hydrated` vs `message-free`) is the route table in
[`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md); the
write set above is identical for every route in a family because all of them go
through the same broad helper, which is exactly the mismatch this plan narrows.

The `commandMetrics.test.ts` message-heavy harness (12 characters × 8 chats × 40
messages) asserts this baseline: the three sampled `message-free` commands
(`settings.updated`, `pluginStorage.updated`, `chat.updated`) each report all 13
`BROAD_WRITE_TABLES`, while `character.selected` reports only
`{characters, settings}`. That before/after table-set diff — not a timing
inference — is the proof a later tier narrowed the write.

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandMetrics.test.ts`
- `pnpm api:test`
