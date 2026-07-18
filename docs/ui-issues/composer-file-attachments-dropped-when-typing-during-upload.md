# Composer file attachments are silently dropped when the user types during upload

## Summary

Pasting or attaching a file starts an upload guarded by a composer-version
fence. The fence keys on the whole-composer mutation version, which advances on
every keystroke and on background auto-translate writes. If the user types
anything before the upload finishes, the completed upload is discarded
silently: the asset bytes and the server inlay-catalog row are already
persisted (orphaned), but the attachment never appears in the composer strip
and no error is shown.

## Location

- `src/lib/ChatScreens/DefaultChatScreen.svelte:426-443` —
  `beginComposerFileOperation` snapshots `composerMutationVersion`;
  `isCurrentComposerFileOperation` requires it unchanged (:437-443).
- `src/lib/ChatScreens/DefaultChatScreen.svelte:386-402` —
  `markComposerDraftChanged` bumps `composerMutationVersion` on **every**
  composer field change (each keystroke).
- `src/lib/ChatScreens/DefaultChatScreen.svelte:498-526` —
  `applyChatFileResultsForCurrentComposer` returns `false` silently.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:561-601` —
  `handleComposerPaste` returns mid-loop, discarding already-collected files.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:603-617` — `postFileFromMenu`.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:1325-1335` — auto-translate
  results also bump the version.
- `src/ts/process/files/multisend.ts:194-328` →
  `src/ts/process/files/inlays.ts:235-275` — `postInlayAsset` uploads bytes and
  registers the server inlay-catalog row *before* the apply step.

## Trigger

Paste an image into the composer (or attach via menu "Post File"), then type
any character — or let `useAutoTranslateInput` write the translation field —
before the upload finishes.

## Expected behavior

The attachment appears in the composer file strip (the apply is append-only, so
it composes safely with concurrent typing), or at minimum an error is surfaced.

## Actual behavior

The upload completes server-side (asset bytes plus inlay-catalog upsert are
persisted), but the version fence fails and the result is dropped. The pasted
image never appears anywhere; the server keeps an orphaned inlay asset. In
multi-file pastes, files already collected are discarded too.

## Underlying cause

The staleness fence was added deliberately (commit `47d7505f8` "guard composer
file callbacks") but is too broad: it keys on the whole-composer mutation
version even though the apply is append-only over live state
(`nextMessageInput = messageInput`). The correct invalidations are only "newer
file operation" (already covered by `composerFileOperationGuard.isLatest`),
transcript-identity change, and send/clear.

## Affected data flow

1. **UI:** paste → `beginComposerFileOperation` (version N).
2. **Request:** `postChatFile` → server `PUT /assets` + inlay-catalog command
   persist.
3. **Client state:** user types → version N+1.
4. **Response apply:** version fence fails → silent drop.
5. **Displayed state:** no attachment, no error; orphaned server asset.

## Severity and likely user impact

**Medium.** Silent loss of a user action the UI accepted; recurring for users
who keep typing while an image uploads (a natural pattern).

## Recommended fix

Drop `composerVersion` from `isCurrentComposerFileOperation` and rely on the
operation guard plus `targetIdentity`; track a separate "composer cleared/sent"
epoch for real invalidation. When a result is still dropped, surface a
toast/`alertError` instead of returning silently.

## Test gap

Component test: begin a file operation, bump the draft (simulated keystroke),
complete the upload, and assert the file lands in `fileInput` (or, if the
narrow invalidation applies, that a visible error is produced).
