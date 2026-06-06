# Slice: Media Leaks And Logs

Phase: [8](../../phase-8-client-interpreters-plugins-media.md). Findings:
L50, L51, L52, L53, L54, L55, and K4. Riding informational items: I16 and
I17. Client media lifecycle and log-hygiene change.

## Scope

Remove large payload logs from media and translator paths, pair object URL and
AudioContext creation with teardown, dispose VITS/PDF resources, and make
stableDiff reference-image loading settle on corrupt inputs.

This slice owns the media/file sites named below. It may include I16 and I17
because they are the same log sweep. It does not own unrelated object URL
inventory items I13/I14 unless already touched incidentally, nor does it
change media encoding, provider payload shape, TTS voice routing, or
Playground subtitle UX beyond lifecycle cleanup.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L50-L55, K4, I16, and I17.
- `src/ts/process/stableDiff.ts`: image-generation payload logs, comfy
  poll-loop log, NAI reference-image resize/load, and corrupt image handling.
- `src/ts/process/files/inlays.ts`: `postInlayAsset` and `reencodeImage`
  object URL lifecycles.
- `src/ts/process/processzip.ts`: `CharXWriter.writeJpeg` object URL
  lifecycle.
- `src/ts/process/scriptings.ts`: sibling object URL sites around image
  processing.
- `src/ts/process/transformers.ts`: `runVITS`, VITS synthesizer/model
  replacement, and embedding extractor disposal precedent.
- `src/ts/process/tts.ts`: `getNetworkAudioContext` precedent plus GPT-SoVITS,
  FishSpeech, and ElevenLabs log sites for riding I16.
- `src/ts/process/dynamicutils/pdf.ts`: `convertPdfToImages` and pdf.js
  document lifecycle.
- `src/lib/Playground/PlaygroundSubtitle.svelte`: whisper-mode
  `AudioContext` sites and probe-video object URL.
- `src/ts/translator/translator.ts`: LLM translator `translatorNote` logs for
  riding I17.
- Existing focused tests:
  `src/ts/process/files/tests/inlays.test.ts`,
  `src/ts/process/processzip.test.ts`,
  `src/ts/process/tts.test.ts`, and translator tests near
  `src/ts/translator/translator*.test.ts`. Add stableDiff/PDF/subtitle tests
  near touched modules if needed.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts` and
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) for
  L50-L55/K4 proof registration.

## Target Shape

- Remove image-generation payload logs from `stableDiff.ts`, including
  multi-MB base64 responses, full DALL-E responses, NAI request bodies with
  base64 reference images, and the 1-second comfy poll-loop log. If any log is
  retained, gate it behind explicit debug mode and avoid payload bodies.
- Fold riding I16 and I17 into the same log sweep if the files are touched:
  remove or gate GPT-SoVITS/FishSpeech/ElevenLabs raw body logs and LLM
  translator `translatorNote` logs.
- Revoke object URLs in `finally` at every touched image-processing site:
  `postInlayAsset`, `reencodeImage`, `CharXWriter.writeJpeg`, and the sibling
  `scriptings.ts` sites. Successful and rejected paths must both revoke.
- Replace per-call `runVITS` `AudioContext` construction with a shared helper
  that reuses or closes contexts safely, mirroring `getNetworkAudioContext`.
  Add the missing `decodeAudioData` error callback so decode failures settle.
- Dispose the old VITS synthesizer before replacing it on model switch,
  following the embedding extractor precedent.
- Call `pdf.destroy()` in a `finally` after PDF image conversion, and await it
  when the API returns a promise.
- Close whisper-mode `AudioContext`s in Playground subtitles and revoke the
  probe-video object URL after probing, including error paths.
- Add `onerror` and a timeout to the stableDiff NAI reference-image load so a
  corrupt reference image rejects or returns a clear failure instead of hanging.
- Register L50, L51, L52, L53, L54, L55, and K4 as `DONE` in the v3 gate and
  flip only those scheduled rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).
  Mention I16/I17 in proof text if they ride, without inventing scheduled
  status rows.

## Invariants

- Media bytes, image resizing, prompt/provider payloads, subtitle conversion
  output, and TTS playback behavior stay unchanged on success.
- Object URLs are revoked only after the consuming operation has completed or
  failed.
- Shared AudioContext reuse must handle closed or suspended contexts.
- Resource cleanup must run on both success and failure paths.
- No default log path may print base64 media payloads, raw audio buffers, full
  translator notes, or transfer-sized provider bodies.

## Done Criteria

- Image-generation sends emit no default payload/body logs, including the
  comfy poll loop.
- TTS and translator riding logs are removed or gated if included in the
  slice.
- All named object URL sites revoke URLs in `finally`.
- Repeated `runVITS` calls do not grow live `AudioContext`s without bound,
  decode failures settle, and model switches dispose the old synthesizer.
- PDF conversion destroys the pdf.js document in `finally`.
- Whisper subtitle conversions close created audio contexts and revoke the
  probe-video URL.
- Corrupt stableDiff reference images fail fast through `onerror` or timeout.
- L50-L55 and K4 are registered as `DONE` in the v3 gate and active-risk
  table, with I16/I17 proof text if they ride and no unrelated ID status
  changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/process/files/tests/inlays.test.ts \
  src/ts/process/processzip.test.ts \
  src/ts/process/stableDiff.test.ts \
  src/ts/process/tts.test.ts \
  src/ts/process/dynamicutils/pdf.test.ts \
  src/lib/Playground/PlaygroundSubtitle.test.ts \
  src/ts/translator/translator.cache.test.ts \
  src/ts/translator/translator.html.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
