# Concurrent message translations allow an older job to win

## Summary

Starting a raw message translation sets only component-local loading state. The
shared active-job store is populated from server bootstrap, not when the request
starts, and the request itself waits for the provider before returning. A second
component, tab, or remounted row can therefore start another translation for the
same message while the first is running.

Fastify's job registry uses a token to prevent the older job from overwriting
the newer **status**, but the actual translation write is not fenced by that
token. If the older provider finishes last, its result can overwrite the newer
translation in SQLite while the registry continues to report the newer job as
the successful one.

## Location

- `src/lib/ChatScreens/Chat.svelte:744-839` captures a stable translation target
  and applies returned translation data to the live row.
- `src/lib/ChatScreens/Chat.svelte:872-918` sets only the component-local
  `translating` flag, waits for `translateMessageCommand()`, and applies any
  successful response without a cross-component operation token.
- `src/lib/ChatScreens/Chat.svelte:1134-1139,2089-2124` disables a row's button
  only when that component is translating or the shared bootstrap job store
  already contains a running entry.
- `src/lib/Others/BookmarkList.svelte:354-409` can render the same underlying
  message through another `Chat` component when a bookmark is expanded.
- `src/ts/server/messageTranslationJobs.ts:16-54` receives jobs from bootstrap
  and starts polling only if a running job is already in that store; it does not
  publish a locally started request.
- `src/ts/server/commands.ts:4959-4975` sends
  `POST /messages/:messageId/translate` and waits for its final response.
- `server/fastify/src/messageTranslationJobs.ts:34-43` overwrites the active
  entry on every `register()` and gives each handle a private token.
- `server/fastify/src/messageTranslationJobs.ts:54-69` fences only terminal job
  status by comparing the token.
- `server/fastify/__tests__/messageTranslationJobs.test.ts:51-65` verifies that
  an older handle cannot settle a newer status entry, but does not couple that
  token to message persistence.
- `server/fastify/src/routes/commands.ts:6306-6403` waits for translation, checks
  only that source `data` is unchanged, writes the translation, and only then
  calls `translationJob.succeed()`.

## Trigger

1. Show the same durable message in two independently mounted places, such as
   the main transcript and an expanded bookmark, or open it in two browser tabs.
2. Start Translate/Retry Translate in the first view with a slow provider.
3. Before it returns, start translation from the other view, potentially after
   changing translator settings.
4. Let the newer job complete first and the older job complete last.

The same race can be reached by navigating away and remounting the row before
the original request returns. A concurrent manual translation edit from another
view is also vulnerable because the raw job's commit precondition ignores the
existing `translation` field.

## Expected behavior

There should be one current translation operation per message. The server must
either deduplicate concurrent requests, cancel/supersede the old provider work,
or reject an old result at commit time. All mounted views should immediately
show the shared running state, and only the latest operation should be able to
update SQLite and the UI.

## Actual behavior

Both provider calls run. Each captures the same source text, so both pass the
only commit precondition. The completion order decides the stored translation:
an older job that finishes last overwrites the newer result.

The status outcome can be actively misleading. If job B replaces job A in
`activeByMessage`, B writes and calls `succeed()`, the registry records B as
successful. When A later writes, A's `succeed()` sees that its token is no
longer active and does nothing. SQLite now contains A's old result while job
status still describes B's success. Each waiting component also applies its own
response without a shared latest-operation fence.

## Underlying cause

The migration split translation into three ownership domains that are not
joined by one operation ID:

1. component-local `translating` controls the initiating button;
2. bootstrap job state controls reattached/loading UI; and
3. the message row is persisted in a later independent transaction.

The registry token protects domain 2 only. The route never asks whether its
handle is still current before `applyTargetedCommandMutation()`, and the
transaction validates only `location.message.data === source.data`. It does not
compare the operation token, captured translation/settings hash, or previous
translation value.

The existing reattachment support makes detached jobs visible after a bootstrap
refresh, but it does not publish the locally started job during the provider
wait and does not fence its write. The per-component translation editor
operation counter similarly cannot coordinate another component or server job.

## Affected data flow

1. **UI interaction:** Each `Chat` instance sees no shared running job and calls
   `requestServerRawTranslation()` for the same message ID.
2. **Client state:** Each sets its own `translating = true`; neither inserts a
   pending entry into `activeMessageTranslations`.
3. **Requests:** Two `POST /api/v1/commands/messages/:messageId/translate`
   requests wait independently for the provider.
4. **Server job state:** Request B's `register()` replaces A's active status
   entry and token.
5. **Persistence:** Both routes validate the unchanged source text and perform
   `updateActiveMessageById(..., { translation })`; no registry-token check is
   part of either transaction.
6. **Acknowledgement:** The status registry accepts completion only from the
   currently registered token, while both HTTP requests can still return
   successful translation payloads.
7. **Displayed state:** Each component conditionally finds the stable row but
   unconditionally applies its own successful result. Server events/hydration
   can then make all views converge on whichever unfenced DB write happened
   last, not necessarily the latest requested operation.

## Severity and likely user impact

**High.** Translation providers can be slow and charge per request, making this
race both plausible and potentially costly. Users can see a newer retranslation
or manual correction revert, while the UI reports the wrong job as successful.
The stored translation can also be based on obsolete settings even though its
source text still matches.

## Recommended fix

Use one end-to-end translation operation identity:

1. Have the client create or receive a job ID immediately and publish a running
   entry keyed by message ID to shared state before awaiting the provider.
2. On the server, either return the existing active job for duplicate starts or
   explicitly supersede/cancel it.
3. Add `isCurrent(jobId/token)` to the registry and check it inside the same
   transaction that writes the translation. An obsolete job must not mutate the
   message row even if source text still matches.
4. Include expected source hash, settings hash, and expected previous
   translation/version where appropriate. A concurrent manual edit should make
   the raw job conflict.
5. Fence client response application by the same operation ID and clear shared
   state only for the matching job.

An accepted-job/202 endpoint plus status/result polling or stream reattachment
would make immediate cross-component ownership explicit, but a synchronous
endpoint still needs server-side deduplication and commit fencing.

## Test gap

Add a server test with two deferred translator promises for one message. Resolve
job B and then job A; assert A cannot write, SQLite retains B, and bootstrap
status/result refer to B. Add a UI/store test proving a locally started job
disables a second mounted `Chat` instance before any bootstrap refresh.
