# Reattached message translation failures disappear without feedback

## Summary

Raw-message translation is deliberately allowed to continue on the Fastify server after the initiating browser disconnects. A returning browser can rediscover that the translation is running, but the reattachment projection contains only active jobs. If the provider request or final commit fails, the job simply vanishes from the projection. The row stops showing its spinner and returns to the untranslated message without surfacing the error that Fastify returned to the now-disconnected request.

## Location

- `src/lib/ChatScreens/Chat.svelte:858-903,1095-1135`
- `src/ts/server/commands.ts:4875-4891`
- `src/ts/server/messageTranslationJobs.ts:4-50`
- `server/fastify/src/messageTranslationJobs.ts:3-32`
- `server/fastify/src/routes/bootstrap.ts:30-56`
- `server/fastify/src/routes/commands.ts:5924-6020`

## Trigger

1. Start raw translation for a message.
2. Reload, close and reopen, or otherwise disconnect the initiating page while the provider request is still running.
3. Return while the request is active. Bootstrap restores the row's translation spinner.
4. Let the operation fail, for example because the provider rejects the request, the credential is invalid, or the source message changes before the translated text can be committed.

## Expected behavior

Reattachment should preserve a terminal outcome as well as the running state. On failure, the returning client should stop the spinner and show a durable or at least fetchable error associated with the message. On success, it should reconcile the persisted translation.

## Actual behavior

The spinner disappears on the next five-second bootstrap poll, the original untranslated message remains, and no status or error is shown. From the returning client's perspective, a failed job is indistinguishable from a job that was never started or was silently cancelled. Only a browser that keeps the original HTTP request alive receives `result.error` through `requestServerRawTranslation()`.

## Underlying cause

`MessageTranslationJobRegistry` is an in-memory set of `{ chatId, messageId, token }` entries. `activeTranslations()` deliberately projects only the two identifiers, and the `finally` block removes the entry for every terminal outcome. There is no terminal status, error, completion token, or result endpoint.

The client mirrors that lossy model. `activeMessageTranslations` polls bootstrap only while at least one active row exists and replaces the store with the latest active-only array. `Chat.svelte` remembers that it saw an active job, but when the row disappears it only enables translated display if a raw translation is now present. The failure branch has no state to inspect and resets `sawServerTranslationInProgress` without a message.

The server does return a command error when translation or the source-text precondition fails, but detaching the server abort signal only keeps the work alive; it does not make the HTTP response recoverable after the browser connection is gone.

## Affected data flow

1. **UI action:** The message Translate action calls `requestServerRawTranslation()` and sets the row's local `translating` flag (`Chat.svelte:858-879`).
2. **Client request:** `translateMessageCommand()` sends `POST /api/v1/commands/messages/:messageId/translate` and can reconcile a successful response immediately (`commands.ts:4875-4891`).
3. **Server job state:** Fastify detaches the operation from the browser abort signal, captures the message source, and registers the message in `MessageTranslationJobRegistry` (`routes/commands.ts:5924-5954`).
4. **Reattachment response:** After a reload, `GET /api/v1/bootstrap` returns the running `{ chatId, messageId }`, and the row derives its spinner from `activeMessageTranslations` (`routes/bootstrap.ts:39-44`; `Chat.svelte:1112-1116`).
5. **Server persistence:** On success, Fastify checks that the source text is unchanged, persists `message.translation`, and emits `message.updated`. On failure it serializes an error only into the original command response (`routes/commands.ts:5956-6016`).
6. **Terminal cleanup:** The `finally` block removes the registry entry regardless of success or failure (`routes/commands.ts:6017-6020`). No terminal record or event replaces it.
7. **Client reconciliation:** The polling bridge replaces the active-job array with bootstrap's now-empty list (`messageTranslationJobs.ts:38-49`). The row sees no persisted raw translation, clears its remembered-running flag, and displays neither translated text nor an error (`Chat.svelte:1126-1135`).

## Severity and user impact

**Medium.** Translation can be a slow, paid provider request, making reload/reattachment a realistic path. Failures caused by credentials, provider responses, or an intervening message edit are hidden, so users may repeatedly retry paid work and cannot distinguish a synchronization failure from a transient display problem.

## Recommended fix

- Give each translation attempt a stable job id and retain a bounded terminal record containing `status`, safe error text, and completion time.
- Expose terminal outcomes through bootstrap or a message-translation job/status endpoint until the client acknowledges them. A `message.translation.failed` event is another option if event replay is guaranteed for returning clients.
- Have the row reconcile by job id: success should refresh/apply the message translation; failure should clear busy state and show the terminal error.
- Preserve the source-text conflict as a distinct user-facing outcome so the user knows the translation was discarded because the message changed.
- Redact provider secrets and cap retained error length before exposing server errors.

## Test coverage gap

`src/ts/server/messageTranslationJobs.test.ts` verifies that an active entry disappears when bootstrap returns an empty list, but treats that as the whole outcome. Add an integration test that starts a deferred translation, bootstraps a second client, then rejects the provider or edits the source before commit. Assert that the second client receives and displays a terminal failure rather than only observing the spinner disappear. Cover the corresponding successful reattachment path as well.
