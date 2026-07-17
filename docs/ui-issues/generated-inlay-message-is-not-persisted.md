# Server-backed inlay transformation is not persisted

## Summary

On the server-backed generation path, Fastify persists the assistant message before the browser performs the final emotion/image inlay transformation. The browser directly replaces `<Emotion>` with `{{emotion::...}}`, or replaces `<ImgGen>` with `[Generating...]` and eventually `{{inlay::<assetId>}}`. It sends no message command for these replacements, so a refresh or reload restores the server's pre-inlay text; image inlays can also leave their uploaded asset unreferenced.

## Location

- `src/ts/process/serverBackedSendChat.ts:545-598`
- `src/ts/process/inlayScreen.ts:5-50`
- `src/ts/process/files/inlays.ts:215-264`
- `src/ts/server/assets.ts:71-91`
- `src/ts/process/index.svelte.ts:550-555`
- `server/fastify/src/routes/generationChat.ts:1723-1757,2391-2495`
- `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts:788-805`

## Trigger

1. Configure a character with `inlayViewScreen === true` and `viewScreen === 'emotion'` or `'imggen'`.
2. Send a message through the server-backed generation path.
3. Let the model return the corresponding `<Emotion="...">` or `<ImgGen="...">` marker; for image mode, allow image generation/upload to complete.
4. Refresh the character/chat resource or reload the app.

## Expected behavior

The authoritative assistant row should contain the durable rendered marker: `{{emotion::<name>}}` for emotion mode or `{{inlay::<serverAssetId>}}` after image generation succeeds. The transformed message and any asset reference should survive resource refreshes and reloads, and failure should leave a consistent persisted fallback rather than only changing the current browser projection.

## Actual behavior

In emotion mode, the live transcript renders the transformed emotion marker while Fastify still stores the completion containing `<Emotion>`. In image mode, it first shows `[Generating...]` and then the generated image marker while Fastify stores the completion containing `<ImgGen>`. The next authoritative refresh replaces either browser-only result with the older persisted value. An uploaded image asset may have no durable database reference.

## Underlying cause

Fastify is intentionally the sole author of generation results. `persistServerGenerationResult` writes the post-generation assistant message before the terminal frame is consumed, and `index.svelte.ts` explicitly states that the browser issues no generation-result command on a server-dispatch path.

`applyServerBackedTerminal` nevertheless performs another data derivation in the browser. `runInlayScreen` synchronously replaces emotion markers; for image mode it replaces image markers with a placeholder and starts `generateAIImage`, after which `writeInlayImage` uploads the resulting bytes through `POST /api/v1/assets` and returns a server asset id. The immediate transformed text and eventual image marker are assigned directly to `assistant.data` inside `withTrustedResourceWrite`. That helper permits projection mutation; it does not persist the value or generate a command acknowledgement. There is no generic message watcher that turns these assignments into a Fastify write.

The fixture suite even documents the split by saying post-generation image generation/inlay rendering “stays a browser effect,” but it has no reload assertion.

## Affected data flow

1. **UI interaction:** `DefaultChatScreen` sends a message for an emotion- or image-inlay-enabled character.
2. **Server request:** The generation route assembles the prompt, calls the provider, runs server post-generation processing, and persists the assistant row in SQLite.
3. **Server acknowledgement:** The terminal frame carries the persisted revision plus `postGeneration.finalText`/`messagePatch` when applicable.
4. **Client projection:** `applyServerBackedTerminal` applies that patch, calls `runInlayScreen`, and directly assigns `{{emotion::...}}` or the image `[Generating...]` placeholder.
5. **Optional asset request:** In image mode, the browser generates/decodes the image and uploads its PNG bytes to `POST /api/v1/assets`.
6. **Optional client projection:** The image promise directly assigns `{{inlay::<assetId>}}` to the same message row.
7. **Missing message request:** No `PATCH /api/v1/commands/messages/:messageId` or equivalent generation-finalization command carries the inlay text.
8. **Authoritative refresh:** Chat hydration reloads the older persisted assistant data and the displayed inlay reverts.

## Severity and user impact

**High.** A rendered result appears successful but is not part of the conversation record. It disappears after reload or synchronization, different tabs can show different versions of the same message, and server asset storage can accumulate costly generated images that are no longer referenced by any message.

## Recommended fix

Represent inlay completion as an authoritative, revisioned mutation:

- Prefer a server-owned image child job that persists the uploaded asset metadata and final assistant text atomically, then emits the new message revision.
- If generation must remain in the browser, send a dedicated conditional message-finalization command after upload. Key it by character id, chat id, message id, generation id, and the expected pre-inlay text/revision so it cannot overwrite a later edit.
- Keep the placeholder as an explicitly transient UI overlay rather than storing it in the message projection, or persist a recoverable job state if it must survive navigation.
- On upload/finalization failure, retain the authoritative model output and surface the failure without claiming the generated image is saved.

## Test coverage gap

Add route-backed fixtures whose model output contains `<Emotion>` and `<ImgGen>`, with deterministic image generation/asset upload for the latter. Assert each final message mutation is acknowledged, hydrate the chat from Fastify in a fresh client projection, and verify that the same rendered marker remains (and that an image asset resolves to the uploaded bytes). Also cover upload and message-finalization failures so they cannot leave a success-looking, browser-only result.
