# Mutation-Range Metric And Review Gates

Status: planned. Recommended first slice — captures the before-state.

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

- Source files: `server/fastify/src/protocolMetrics.ts` (metric field),
  `server/fastify/src/commands/mutations.ts` (populate the table set),
  `server/fastify/__tests__/commandMetrics.test.ts` (harness + gates),
  `server/fastify/__tests__/commands.test.ts` (rowid template re-use).
- The written-table set is captured at the write boundary (the writer kit and the
  broad `replaceAll*` both report which tables they touched), so the metric is
  truthful for both broad and narrow paths.
- The review-gate template exposes: a per-`mutationPath` expected table set, the
  `dbJsonWriteMs: 0` assertion for targeted paths, and a `tableRowidsById` /
  `activeMessageRowids` stability assertion for the unrelated rows.
- Non-scope: changing any route's write range; this slice only measures and gates.

## Protocol Behavior

- The metric is opt-in (gated behind the existing `RISU_PROTOCOL_METRICS` /
  `RISU_COMMAND_METRIC_SUMMARY` flags); no runtime behavior changes.

## Done When

- `command_mutation` records the written-table set, verified for at least one
  broad and one targeted path.
- The before-state table sets for the 71 over-broad routes are recorded (a table
  in this slice or a fixture the test reads).
- The review-gate template is importable and used by the existing
  `targeted-character-selection` gate without behavior change.

## Measurement

Record the captured before-state here as the baseline (one row per route family).
The expected over-broad table set for a `hydrated` route is `{message store,
characters, chats, modules, plugins, botPresets, promptTemplate, personas,
loadouts, loreBook, translatorPresets, hypaV3Presets, settings}`; for
`message-free` it is the same minus the message store.

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandMetrics.test.ts`
- `pnpm api:test`
