# Plugin import outcomes are silent or misreported

## Summary

`importPlugin` treats every non-`accepted` command outcome as a bare `false`:
a server rejection surfaces no error (the optimistically added row just
vanishes), and a queued/offline outcome — which the durable outbox retains and
will replay successfully — is indistinguishable from failure. The update flow
built on top then reports "install failed" for an install that will in fact
land, and skips its success-path bookkeeping.

## Location

- `src/ts/plugins/plugins.svelte.ts:530-535` — `if (result.status !==
  'accepted') return false`; no alert, `queued` conflated with failure.
- `src/ts/plugins/plugins.svelte.ts:537-544` — `hotReloading` bookkeeping and
  `loadPlugins()` run only on the accepted path, so a queued install never
  reconciles the runtime or reports success.
- `src/ts/plugins/plugins.svelte.ts:120-153` — `installPluginUpdate` maps the
  `false` to `'failed'` → the row shows "install failed".
- `src/lib/Setting/Pages/PluginSettings.svelte:529-538` — the import button
  discards the result entirely, so direct imports show nothing on failure.

## Trigger

- (a) Import a plugin via the "+" button while the server rejects the create
  (conflict/validation/5xx): the row appears optimistically, then vanishes on
  rollback with zero feedback.
- (b) Install a plugin or update while offline: the durable outbox retains the
  mutation (`queued`; it will replay and succeed), yet the flow reports
  failure/nothing and never confirms installation.

## Expected behavior

Server rejection surfaces an error; a queued-but-durable import is reported as
pending — the same tri-state the enable/delete/argument flows already surface
via `trackPluginMutation` (saving/queued/failed).

## Actual behavior

All non-`accepted` outcomes collapse to `false` with no user messaging on the
direct-import path; `queued` (retained, guaranteed replay) is presented as
failure by the update flow.

## Underlying cause

`importPlugin` predates the tri-state `PluginMutationOutcome` contract and
only branches on `accepted`.

## Affected data flow

1. UI import → optimistic collection write → `runCreate/UpdatePluginCommand`.
2. Outcome `failed` (rollback removes the row) or `queued` (row retained +
   outbox replay).
3. `return false` → caller shows nothing or "install failed".

## Severity and likely user impact

**Low-medium.** No data loss (rollback and replay are both correct
underneath), but the reporting is absent or actively wrong: a user who
installs offline sees "failed" for an install that appears by itself later.

## Recommended fix

Propagate the outcome from `importPlugin`: on `failed`, `alertError` with the
command error; on `queued`, treat as success-pending (surface the existing
`pluginMutation.queued` status and settle via the settlement promise before
declaring "installed"), and run the hot-reload/`loadPlugins` bookkeeping on
settlement.

## Test gap

Tests driving `importPlugin` through rejected and retained outcomes, asserting
an error alert and a queued status respectively.
