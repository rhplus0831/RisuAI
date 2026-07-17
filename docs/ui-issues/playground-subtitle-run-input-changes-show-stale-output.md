# Subtitle run applies output after its input controls change

## Summary

The subtitle playground snapshots its mode, prompt, and language controls when a run starts, but it only identifies the in-flight work by component/run lifetime. The controls remain editable and changing them does not invalidate the run. A response for the old controls can therefore continue streaming into the current UI and be presented as if it belonged to the newly displayed controls.

## Location

- `src/lib/Playground/PlaygroundSubtitle.svelte:31-40,53-109`
- `src/lib/Playground/PlaygroundSubtitle.svelte:147-265,268-526`
- `src/lib/Playground/PlaygroundSubtitle.svelte:529-572,660-729`
- `src/ts/process/request/request.ts:579-652,832-907`
- `src/ts/process/request/serverCompletion.ts:172-219`
- `src/ts/server/openAITranscription.ts:4-34`
- `server/fastify/src/routes/generation.ts:1300-1318`
- `server/fastify/src/routes/openAITranscription.ts:16-67`

## Trigger

1. Start a subtitle run, for example LLM mode with destination language `English`.
2. While file processing or provider streaming is still in progress, change the destination language, prompt, source language, or mode. For example, change the destination to `Korean` or switch the mode to Whisper.
3. Let the original request finish.

## Expected behavior

Changing a control that defines the request should either cancel/invalidate the active run, clear its output, or be disabled until the run completes. Any completed result should retain and display the exact configuration that produced it.

## Actual behavior

The old run continues and writes its chunks and final WebVTT into `outputText`, `vttB64`, `fileB64`, and `vobj`. The screen now shows output generated from the old prompt/language/mode beside the new control values. The preview track is additionally labeled with the live `selLang`, so an English result can be emitted with `srclang="Korean"` after the user changes the field during the run.

## Underlying cause

`runSelectedMode()` captures `runMode`, `promptSnapshot`, `languageSnapshot`, and `sourceLanguageSnapshot`, which correctly keeps the request body internally consistent. However, `SubtitleRun` only stores an `AbortController`, stream reader, and local pipeline. `isCurrentRun()` checks component lifetime and `activeRun` identity but never checks whether the live controls still match the initiating snapshots.

The destination, prompt, source-language, and mode controls remain enabled while `running` is true. Only the Run button is disabled. No control handler aborts `activeRun`, advances a request epoch, or clears results. Consequently every `requireCurrentRun()` check still succeeds after a control edit, and both stream loops keep assigning the old response to current component state.

## Affected data flow

1. **UI:** The user starts a run, then edits `selLang`, `prompt`, `sourceLang`, or `mode` while it is active (`PlaygroundSubtitle.svelte:660-698`).
2. **Client state:** `runSelectedMode()` snapshots the old values and creates an active run that has no input signature (`PlaygroundSubtitle.svelte:529-546`). The live controls immediately reflect the later values.
3. **Request:** LLM and translation stages call `requestChatData()` with the snapshots (`PlaygroundSubtitle.svelte:194-213,450-468`). In Fastify mode this becomes `POST /api/v1/generate/completion` (`request.ts:904-907`; `serverCompletion.ts:194-219`; `generation.ts:1306-1318`). Whisper mode may first send the media to `POST /api/v1/media/openai/transcriptions` (`openAITranscription.ts:8-34`; `routes/openAITranscription.ts:22-52`).
4. **Server response:** Fastify streams completion chunks or returns a WebVTT transcription. The server has no knowledge that the browser controls changed after submission.
5. **Client reconciliation:** The run guard accepts every result because the same `SubtitleRun` is still active. The old chunks and final conversion overwrite the shared output fields (`PlaygroundSubtitle.svelte:226-259,445-520`).
6. **Display:** The output and media preview render from those shared fields, while the controls and `<track srclang>` render from current live state (`PlaygroundSubtitle.svelte:710-729`).

No subtitle result is durably persisted; the defect is request-to-view synchronization and can also affect the downloaded file.

## Severity and user impact

**Medium.** Long transcription and media requests make the race easy to encounter. A user can preview or download subtitles generated for the wrong language, prompt, or mode without any indication that the result belongs to the previous values, potentially wasting a costly provider request and subsequent editing work.

## Recommended fix

- Add the initiating mode/prompt/destination/source language to the run owner or store a monotonically increasing input revision in `SubtitleRun`.
- Abort and invalidate `activeRun` whenever a request-defining control changes, or disable those controls while `running` is true.
- Check run ownership immediately before every output assignment and final conversion.
- Store result provenance (at minimum the destination-language snapshot) and use it for the preview track and download metadata rather than live `selLang`.
- Clear an old result when a request-defining control changes so completed output cannot be mistaken for a new configuration.

## Test coverage gap

`src/lib/Playground/PlaygroundSubtitle.svelte.test.ts` covers cancellation during teardown and asynchronous failure recovery, but not a control edit during a delayed file selection, transcription, or completion stream. Add a deferred-stream test that changes the destination/mode before resolving the old stream and asserts that the old output is discarded or the controls are locked.
