# Image translation response can overwrite a newer JSON edit

## Summary

After manual image translation has produced output, its JSON textarea stays editable during later translation requests. A late response reparses whatever text is currently in that editor and replaces the entire field. If the user is midway through a temporarily invalid JSON edit, the parse error is silently ignored and all prior items and edits are discarded before the new result is appended.

## Location

- `src/lib/Playground/PlaygroundImageTrans.svelte:92-105,148-162,274-335,487-494`
- `src/ts/process/request/request.ts:579-652,832-907`
- `src/ts/process/request/serverCompletion.ts:172-239`
- `server/fastify/src/routes/generation.ts:1280-1297,1300-1318`

## Trigger

1. In manual image-translation mode, complete at least one translation so the JSON editor is visible.
2. Start another translation.
3. While it is loading, edit the existing JSON. Leave it temporarily incomplete or otherwise invalid, as is normal while typing.
4. Let the provider response complete.

## Expected behavior

A response should not overwrite a local edit made after that request began. The editor should either be disabled while the request is active, the run should be invalidated by edits, or the new item should be merged only against the exact output snapshot that initiated the request. Invalid current JSON should produce a visible conflict/validation error and preserve the user's text.

## Actual behavior

The completion is accepted because output is not part of `isCurrentRun()`. The client attempts `JSON.parse(output)`, catches and ignores any error, leaves `outputObj` as an empty array, appends only the new provider result, and assigns the serialized one-item array back to `output`. The user's in-progress edit and every prior translated region disappear without warning.

Even when the edit remains valid JSON, the completion silently merges into a value that did not exist when the request started. There is no acknowledgement policy that distinguishes intentional concurrent editing from a superseding local change.

## Underlying cause

The run signature covers mode, image, prompt, and language but omits an output revision or initiating output snapshot. The textarea is rendered with a live two-way binding and is not disabled by `loading`.

On completion, the manual branch reads the live `output`, not a request-owned snapshot. Its empty-array fallback and empty `catch` turn an expected transient parse error into destructive replacement. The later unconditional `output = JSON.stringify(outputObj, null, 2)` makes the server response win over the newer local text.

## Affected data flow

1. **UI action:** A prior result exposes the bound JSON textarea. The user starts another request, then changes `output` while the Translate button alone is disabled (`PlaygroundImageTrans.svelte:479-494`).
2. **Client request state:** `imageTranslate()` captures request-defining image/prompt/language state but neither snapshots `output` nor records an output edit epoch (`PlaygroundImageTrans.svelte:148-162`).
3. **Request:** The selected crop is sent through `requestChatData()` and then `POST /api/v1/generate/completion` in Fastify mode (`PlaygroundImageTrans.svelte:274-292`; `request.ts:904-907`; `serverCompletion.ts:194-219`).
4. **Server response:** Fastify returns the structured translation for the submitted crop. The server does not and cannot arbitrate the browser's later JSON edit.
5. **Client reconciliation:** After the broad run guard passes, the response handler parses the live editor. Parse failure is swallowed and converted to `[]`; the new item is then pushed (`PlaygroundImageTrans.svelte:294-323`).
6. **Displayed state:** Serializing `outputObj` replaces the bound textarea and triggers rendering from the replacement array (`PlaygroundImageTrans.svelte:324-327`).

No server data is persisted; the loss occurs in local playground state, but it exactly follows a stale-response-overwrites-newer-edit race.

## Severity and user impact

**Medium.** Users can manually refine translations, colors, coordinates, and layout in the JSON editor. A slow follow-up provider response can erase that work and prior regions silently. Because the replacement is valid JSON and immediately rerenders the canvas, it looks like a normal successful acknowledgement rather than data loss.

## Recommended fix

- Track an output edit revision and include it in the active run. If it changes, discard the old result or present a merge decision without replacing the editor.
- Prefer snapshot-based compare-and-swap: append only when current output still equals the initiating snapshot.
- Disable the JSON editor during an active run if concurrent edits are not supported.
- Never treat invalid live JSON as an empty array. Preserve the text and show a validation/conflict error.
- Model parsed output separately from the raw editor draft so temporarily invalid text does not destroy the last valid render model.

## Test coverage gap

Add a deferred completion test that starts with two output entries, begins a third request, edits the textarea to invalid JSON, and then resolves the request. Assert that the draft and prior entries survive and that a conflict or validation error is visible. Add a valid concurrent-edit case to define whether the response should be discarded, queued, or explicitly merged.
