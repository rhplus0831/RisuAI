# Accepted plugin replays can remain queued and excluded from runtime

## Summary

Plugin mutations retain optimistic operation records when a retryable request is
queued, but the plugin domain never subscribes to the durable outbox's later
accepted/discarded settlement. It clears an operation only inside the original
command callback when that exact public command returns success.

This fails in a normal same-session predecessor replay. If an edit to plugin A
is queued, a later edit to plugin B first replays and successfully persists A.
If B then has another retryable failure, A's accepted settlement is published,
but A's operation and per-plugin Queued UI state remain. The collection UI keeps
overlaying optimistic records, and plugin runtime deliberately remains pinned to
the pre-A accepted baseline.

## Location

- `src/lib/Setting/Pages/PluginSettings.svelte:38-43,95-123` stores mutation
  state by plugin name and changes it only when the initially returned promise
  settles.
- `src/lib/Setting/Pages/PluginSettings.svelte:380-423` dispatches enable/delete
  actions and renders the per-plugin Saving/Queued/Failed status.
- `src/ts/pluginCommands.ts:54-62` returns an outcome with no mutation ID or
  later-settlement handle.
- `src/ts/pluginCommands.ts:241-300` stages and dispatches a durable plugin
  mutation but does not register a settlement listener.
- `src/ts/pluginCommands.ts:329-613` clears create/update/delete/enable/provider/
  reorder operation records only from the original successful command callback.
- `src/ts/pluginCommands.ts:1015-1054` advances/releases the accepted runtime
  baseline only when those operation records are cleared.
- `src/ts/pluginCommands.ts:1252-1297` reapplies all retained plugin storage,
  collection, and provider operations over authoritative resource reads.
- `src/ts/server/durableMutationDispatch.ts:308-335,339-379` replays an outbox
  request and publishes final `accepted` or `discarded` settlement without
  invoking the original domain callback.
- `server/fastify/src/routes/commands.ts:7757-7928` validates and persists plugin
  create/update/delete/enable commands.

## Trigger

One reproducible multi-target sequence is:

1. Change an argument, script/runtime field, or enabled state for plugin A.
2. Make that request fail retryably after its outbox row is persisted, so the UI
   reports Queued and the plugin operation remains optimistic.
3. Before reloading, change plugin B. Plugin collection mutations share one
   durable lane, so dispatch drains A's predecessor first.
4. Let A's replay succeed. Fastify commits A and the durable dispatcher publishes
   its accepted final settlement.
5. Make B's request fail retryably and remain queued.

Using different plugins is important: B's UI promise cannot incidentally replace
A's per-plugin status, and B's non-success callback does not clear the older
accepted operation.

## Expected behavior

After A's replay is accepted:

- A's Queued label should clear;
- A's optimistic record should retire in favor of the authoritative row;
- the accepted runtime projection should advance to include A's accepted
  script/enabled state; and
- only B should remain overlaid and marked Queued.

If replay terminally discards A instead, its guarded rollback should run and A
should show a final failure without overwriting any newer edit.

## Actual behavior

A remains marked Queued even though SQLite contains the change. Its operation is
still included by `mergePendingPluginCollectionResource()` and can mask later
authoritative values.

More seriously, `acceptedPluginRuntimeProjection()` continues returning the
baseline captured before A's optimistic runtime-affecting edit. The settings UI
can show plugin A enabled or updated, and Fastify can have that row persisted,
while the client continues executing the old accepted plugin projection because
the baseline is not advanced/released. Plugin B correctly remains queued, but it
unintentionally prevents A's independently accepted state from settling.

The inverse terminal-discard path can leave a rejected operation projected until
a recovery reload, rather than settling it through the domain's existing
per-field rollback fences.

## Underlying cause

`dispatchPluginDurableTransport()` keeps the staged outbox handle private and
returns only a promise plus the immediate retain/rollback disposition.
`PluginMutationOutcome` similarly exposes only `accepted`, `queued`, or `failed`.

The durable dispatcher has an explicit final-settlement API, but
`pluginCommands.ts` imports only `dispatchDurableMutation`; it never calls
`registerDurableMutationSettlementListener()`. Consequently, operation lifetime
is coupled to the original callback rather than to the outbox row's true final
state. Raw predecessor replay is intentionally generic and cannot know which
plugin operation record or runtime baseline to clear.

## Affected data flow

1. **UI interaction:** A plugin argument input calls `setPluginArgument()`, or
   the power button calls `togglePluginEnabled()`.
2. **Client projection:** `pluginCommands.ts` updates the resource database and
   registers a pending non-storage operation. Runtime-affecting changes capture
   an accepted baseline so unaccepted code is not executed.
3. **Request:** The client stages a `plugin-collection` outbox row and sends
   `PATCH /api/v1/commands/plugins/:pluginId` or
   `POST /api/v1/commands/plugins/:pluginId/enable`.
4. **Initial acknowledgement:** A retryable failure returns a Queued outcome.
   `PluginSettings.svelte` stores Queued for that plugin; the pending operation
   remains by design.
5. **Replay:** A later same-lane plugin mutation drains the predecessor by
   replaying its stored raw request. Fastify writes the plugin collection row and
   returns the revision/event; the durable dispatcher publishes `accepted` for
   the predecessor mutation ID.
6. **Missing domain settlement:** No plugin listener consumes that event. If the
   successor remains queued, no successful plugin callback calls
   `clearPluginNonStorageOperation()` for either its own sequence or the accepted
   predecessor.
7. **Displayed/runtime state:** Resource reads are overlaid with the stale
   operation, A's Queued text persists, and `acceptedPluginRuntimeProjection()`
   continues exposing the old baseline to plugin execution.

## Severity and likely user impact

**High.** Plugin enabled/script state is security- and execution-sensitive. The
server, settings UI, and code actually permitted to run can represent three
different versions. Users may repeatedly retry an already-saved change, believe
an enabled plugin is executing when it is not, or see later server-side changes
masked by a stale optimistic overlay.

## Recommended fix

Make each plugin operation follow its outbox mutation ID through final
settlement:

1. Register a durable settlement listener immediately after staging the outbox
   and associate it with the exact operation token/rollback entries.
2. On `accepted`, clear that operation, advance the accepted runtime baseline
   through its entries, and notify observable per-plugin mutation state.
3. On `discarded`, run the existing guarded rollback for that operation, release
   any runtime baseline that is now settled, and publish a final failure.
4. Preserve sequence fences so final settlement for A cannot roll back or clear a
   newer B/A edit.
5. Expose mutation ID/final settlement from the domain, or move the UI status
   entirely into a central observable plugin mutation store rather than keeping
   a component-only snapshot of the first promise.

Apply the same lifecycle to plugin storage operations, whose resource overlay
has the same callback-only lifetime.

## Test gap

Add a durable integration test with two plugins: retain A, dispatch B, accept A's
predecessor replay, retain B, and assert that only B remains in pending merges,
A's runtime projection is advanced, and A's UI status clears. Add the symmetric
terminal-discard case and verify guarded rollback plus final failure without
touching B's newer projection.
