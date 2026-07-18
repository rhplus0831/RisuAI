# Agent preset delete failure can strand cleared chat/loadout references

## Summary

Deleting an agent preset optimistically clears every chat and loadout
reference to it. If the DELETE is terminally rejected without changing server
state, the preset row is restored — but the per-row reference restore is
fenced by projection epochs, and any concurrent character-row refresh (for
example a streaming generation writing messages) suppresses it without forcing
a re-read. The sidebar then shows "Not selected" while the server still has
the selection, so a later send runs the agent preset server-side while the UI
claims none is active.

## Location

- `src/ts/agentPresets.ts:1033-1070` — delete optimistically clears
  `chat.generationSettings.agentPresetId` and loadout references.
- `src/ts/agentPresets.ts:1223-1278` — per-character/collection projection
  epochs captured for the rollback.
- `src/ts/agentPresets.ts:1298-1310` — `restoreAgentPresetDeleteFields` skips
  the restore whenever the epoch changed, for any reason.
- `src/ts/agentPresets.ts:612-617` — terminal-failure rollback path; it taints
  the `agents` settings group but never re-reads the affected character rows
  or loadouts.
- `server/fastify/src/commands/agentPresets.ts:179-212` — server-side delete
  cascade (the state that remains authoritative when the delete is rejected).

## Trigger

1. Delete a preset that at least one chat currently selects.
2. The DELETE is terminally rejected without changing server state
   (stale-writer/lineage rejection, malformed request — a 404 discard is the
   correct-to-skip case).
3. During the in-flight window, any refresh bumps the affected character row's
   projection epoch (routine while a generation streams).

## Expected behavior

On rollback, both the preset row and the cleared chat/loadout selections are
restored, or the affected rows are re-read from the server.

## Actual behavior

The preset row is restored and `agents` is tainted for reconciliation, but the
epoch fence suppresses the reference restore and nothing forces a re-read.
Client and server disagree about a generation-affecting field until some
unrelated event refreshes that character row.

## Underlying cause

The epoch fence is deliberately conservative (never clobber a newer row), but
it lacks the compensating "fall back to an authoritative read" step that the
local-effect acknowledgement machinery uses everywhere else.

## Affected data flow

1. **UI:** delete → optimistic preset removal + reference clears.
2. **Request:** DELETE rejected terminally; server keeps preset + selections.
3. **Rollback:** preset row restored; reference restore epoch-fenced away.
4. **Displayed state:** sidebar shows "Not selected"; server assembles with
   the preset on the next send.

## Severity and likely user impact

**Low** (documented at low confidence: the trigger requires a terminal
rejection that leaves server state unchanged plus a concurrent epoch bump, and
it self-heals on the next row read). The divergence is silent and affects
generation behavior while it lasts.

## Recommended fix

When the epoch fence suppresses a reference restore after a failed delete,
queue an invalidation/read of the affected character rows and the loadouts
collection — mirroring the `markSettingsGroupAcknowledgementTainted('agents')`
treatment the preset row itself receives.

## Test gap

A test that fails a delete terminally while bumping one affected character
row's projection epoch, then asserts the client either restores the reference
or schedules a re-read of that row.
