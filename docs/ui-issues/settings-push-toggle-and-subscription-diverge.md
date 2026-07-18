# Push setup failures can leave the notification toggle lying

## Summary

The Notification toggle persists `notification = true` before browser push setup
finishes, but it turns the setting back off only for the explicit
`permission-denied` result. Every other terminal fallback—missing Notification
API, undecided permission, unavailable service worker/Push API/VAPID key,
subscription failure, or Fastify registration failure—leaves the UI and durable
setting enabled without a working registered subscription.

The disable path has the inverse acknowledgement problem. Local unsubscribe
errors and Fastify subscription-DELETE failures are caught and reduced to
warnings/ignored booleans; the reconciler reports Disabled and the setting stays
false even though cleanup may be incomplete.

Settings rollback and authoritative refresh are not part of this defect. A
global runtime-projection hook correctly sends those accepted projection changes
back through the notification reconciler.

## Location

- `src/lib/Setting/Pages/Display/NotificationToggle.svelte:8-19` handles only
  `permission-denied` after an enable attempt.
- `src/lib/Setting/Pages/Display/NotificationToggle.svelte:29-36` persists the
  checkbox value and starts push reconciliation from the click.
- `src/ts/server/pushNotificationSetting.ts:23-83` serializes desired device
  states.
- `src/ts/server/pushNotificationSetting.ts:86-104` treats every resolved enable
  result as an applied state and every resolved disable call as Disabled.
- `src/ts/server/pushNotifications.ts:17-53` returns seven non-enabled fallback
  reasons in addition to `permission-denied`.
- `src/ts/server/pushNotifications.ts:55-81` catches local inspection and
  unsubscribe failures without returning them to the caller.
- `src/ts/server/pushNotifications.ts:147-175,177-204` returns registration/
  deletion success internally, but the disable caller discards the DELETE
  result.
- `src/ts/bootstrap.ts:140-150` installs the global settings runtime-projection
  hook that correctly reconciles rollback and authoritative changes.
- `src/ts/server/settingsBridge.svelte.ts:1580-1595` invokes that hook for
  settings projection rollback/changes.
- `src/ts/server/resourceState.svelte.ts:686-815` invokes runtime projection for
  full, group, and local-effect settings application.
- `server/fastify/src/routes/pushNotifications.ts:19-49` stores and deletes push
  subscription rows.

## Trigger

### Enable fallback

1. Turn Notification on.
2. Allow the settings PATCH to succeed.
3. Make any post-click push prerequisite fail without returning permission
   denied. Examples include no service worker support, VAPID lookup failure,
   `PushManager.subscribe()` failure, or
   `POST /api/v1/push/subscriptions` returning an error.

### Incomplete disable

1. Start with an existing local/server subscription and turn Notification off.
2. Make `subscription.unsubscribe()` throw or return a rejected promise, and/or
   make `DELETE /api/v1/push/subscriptions` fail.
3. Let the ordinary settings PATCH succeed.

## Expected behavior

The durable toggle should be true only when push setup reached the `enabled`
state and Fastify accepted the endpoint. If setup cannot complete, the setting
should return to false and the UI should explain the specific failure.

Disabling should report whether local unsubscribe and server endpoint cleanup
actually succeeded. A partial failure should remain retryable and visible rather
than being represented as fully disabled cleanup.

## Actual behavior

For enable, `reconcileNotificationSetting()` checks only
`outcome.result.status === "permission-denied"`. A resolved `fallback` counts as
an applied reconciliation, so no second settings mutation occurs. The checkbox
and SQLite settings record remain true even though the device has no usable
registered endpoint. Users discover the mismatch only when notifications never
arrive.

For disable, `disableChatCompletionPushNotifications()` resolves `void`
regardless of failures it caught. If an endpoint was found, it awaits
`deletePushSubscription(endpoint)` but ignores its boolean result. The outer
reconciler consequently returns `{ status: "applied", enabled: false }`, and the
UI has no failure state to render. A local subscription or Fastify row can remain
after the toggle says disabled.

Fastify gates actual sends on the persisted `notification` setting, so a false
setting prevents ordinary delivery even if stale subscription data remains. The
disable defect is incomplete cleanup/stale credentials rather than evidence
that notifications will continue to be sent.

## Underlying cause

The push helpers expose useful failure detail on enable but the component
collapses all non-denied results into success. On disable, the helper itself
erases failure detail by catching local errors, discarding the server DELETE
boolean, and returning `void`. The serialized reconciler can order desired
states, but it cannot distinguish a completed state from a best-effort fallback
when its callback resolves normally.

The surrounding settings synchronization is already wired correctly: rollback
and resource application invoke the global runtime-projection hook, which calls
the reconciler with the authoritative setting. The missing acknowledgement is
inside the push operation result handling.

## Affected data flow

### Enable fallback

1. **UI interaction:** The checkbox changes to true.
2. **Settings projection/request:** `applyServerBackedSetting()` optimistically
   changes `getDatabase().notification` and dispatches
   `PATCH /api/v1/commands/settings/display`.
3. **Push setup:** The reconciler calls
   `enableChatCompletionPushNotifications()`, which attempts permission, service
   worker registration, VAPID fetch, subscription creation, and Fastify endpoint
   registration.
4. **Acknowledgement:** A failed prerequisite resolves to `{ status: "fallback",
   reason }`, not an exception.
5. **Missing compensation:** The component checks only `permission-denied`, so it
   does not persist false or display an error for the fallback.
6. **Displayed/persisted state:** The settings command can be fully accepted and
   the checkbox remains true, while no working subscription exists.

### Incomplete disable

1. The checkbox/settings projection changes to false and the settings PATCH
   starts.
2. The push helper looks up the subscription and attempts local unsubscribe.
   Errors are logged and suppressed.
3. It attempts the Fastify DELETE when it has an endpoint; a false result is
   ignored.
4. The helper resolves `void`, so the reconciler reports an applied Disabled
   state and the UI presents no retry/failure state.
5. SQLite settings can correctly contain false while local or server subscription
   state remains stale.

## Severity and likely user impact

**Medium.** The enable path creates a durable false-success state for a feature
users expect to work in the background. The disable path can leave stale browser
or server subscription data while claiming cleanup completed. Message data is
not lost, and Fastify's false-setting gate limits the stale-row privacy impact,
but delivery reliability and cleanup status are materially misrepresented.

## Recommended fix

1. Treat only `{ status: "enabled" }` as a successful enable. For every fallback,
   restore/persist `notification = false`, show a localized reason, and clean up
   any local subscription created before server registration failed.
2. Change `disableChatCompletionPushNotifications()` to return a structured
   result such as local subscription found/unsubscribed and server endpoint
   deleted, including errors. Do not discard `deletePushSubscription()`'s
   boolean.
3. Feed a partial disable result into visible retry state. Keep Fastify's
   notification gate false for safety, while allowing cleanup to be retried
   without making the checkbox falsely imply that all subscription state was
   removed.
4. Preserve the existing global runtime-projection reconciliation so settings
   rollback, remote updates, and rapid successive clicks remain ordered.

## Test gap

Add component/integration tests that assert the setting returns to false for
every `EnablePushNotificationsResult.fallback` reason, including server
registration failure after a local subscription was created. Add disable tests
where local unsubscribe and Fastify DELETE fail independently and together,
asserting a structured failure/retry state rather than an applied Disabled
receipt. Retain coverage proving authoritative settings rollback/refresh still
flows through the global reconciler.
