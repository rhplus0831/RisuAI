# Image translation accepts a result for a superseded selection rectangle

## Summary

Manual image translation snapshots the current selection rectangle when a request starts, but the canvas remains interactive and selection changes do not invalidate the run. A user can draw a new rectangle while Fastify is translating the old crop. The old response is then accepted, appended with the old coordinates, and rendered even though the visible blue selection indicates a different region.

## Location

- `src/lib/Playground/PlaygroundImageTrans.svelte:92-105,148-204,274-327,473-540`
- `src/ts/process/request/request.ts:579-652,832-907`
- `src/ts/process/request/serverCompletion.ts:172-239`
- `server/fastify/src/routes/generation.ts:1280-1297,1300-1318`

## Trigger

1. Open Playground -> Image Translation and choose manual mode.
2. Select an image, draw rectangle A, and start translation.
3. While the request is loading, draw a different rectangle B on the same canvas.
4. Let the request for rectangle A complete.

## Expected behavior

The active selection should be part of request ownership. Redrawing it should cancel or invalidate the old request, or the selection controls should be locked until the request finishes. A result must never be presented as belonging to a different visible crop.

## Actual behavior

The request for rectangle A completes successfully and appends an output item using A's captured coordinates. The blue overlay remains at rectangle B. The rendered translation therefore modifies A while the current interaction state tells the user that B was selected. A subsequent translation can append B as a second item, making the first stale result difficult to identify or undo.

## Underlying cause

`imageTranslate()` correctly captures `x_min`, `y_min`, `x_max`, and `y_max` before building the cropped image. Its `isCurrentRun()` guard checks the mode, mode epoch, image epoch, prompt, and destination language, but not the selection rectangle or a selection epoch.

Only the Translate button is disabled while `loading` is true. The canvas pointer handlers continue to move the selection element whenever the mode is manual; they neither check `loading` nor advance any run-invalidating token. Consequently `isCurrentRun()` still returns true after a redraw and the response is applied with the obsolete coordinates.

## Affected data flow

1. **UI action:** Pointer handlers position the DOM selection overlay. The user starts translation for rectangle A, then redraws it to B while loading (`PlaygroundImageTrans.svelte:479-540`).
2. **Client projection:** `imageTranslate()` normalizes A's DOM rectangle, crops the image into a temporary canvas, and stores A's coordinates in local variables (`PlaygroundImageTrans.svelte:172-204`). The live overlay subsequently moves to B, but there is no reactive selection value or revision in the run signature.
3. **Request:** `requestChatData()` sends the cropped A image and manual JSON schema using the translate model role (`PlaygroundImageTrans.svelte:274-292`). In Fastify mode it becomes `POST /api/v1/generate/completion` (`request.ts:904-907`; `serverCompletion.ts:194-219`).
4. **Server work/response:** Fastify resolves the translate profile, calls the provider, and returns the structured completion. It has no knowledge of the later browser-only selection change (`routes/generation.ts:1306-1318`).
5. **Client acknowledgement:** The completion passes `isCurrentRun()` because every checked input is unchanged (`PlaygroundImageTrans.svelte:157-162,294`).
6. **Displayed state:** The client appends an item with A's captured coordinates and redraws the canvas from `output`, while the selection DOM remains at B (`PlaygroundImageTrans.svelte:304-327,496-540`).

No server data is persisted; this is a request-to-view synchronization defect in the playground result state.

## Severity and user impact

**Medium.** Image translation requests can take long enough that adjusting the crop while waiting is natural. The accepted output is spatially wrong but looks successful, so users can translate or export the wrong part of an image and may spend additional provider calls reconstructing what happened.

## Recommended fix

- Store the selection rectangle in component state and increment a selection revision after every completed pointer gesture.
- Include that revision or a normalized rectangle snapshot in the run owner and reject completion when it no longer matches.
- Alternatively, block canvas pointer interaction while a manual run is active and visually identify the submitted rectangle separately from the next editable selection.
- Pass an `AbortController` to `requestChatData()` and abort the provider request when request-defining state changes where cancellation is supported.
- Keep result provenance with each output item so stale or intentionally retained results can be attributed to their submitted crop.

## Test coverage gap

Add a component test with a deferred `requestChatData()` result. Start a manual run for rectangle A, dispatch pointer events that move the overlay to B, resolve the old request, and assert that the A result is discarded or that redraw is blocked. Also verify that changing only presentation controls such as font family behaves according to an explicit policy.
