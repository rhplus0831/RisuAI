# Slice: Media Leaks And Logs

Phase: [8](../../phase-8-client-interpreters-plugins-media.md). Findings:
L50, L51, L52, L53, L54, L55, and K4. Riding informational items: I16 and
I17. v4 amendments: v4-L31 and v4-L36 where they match the abort/cap
invariants. Client media lifecycle and log-hygiene change.

## Scope

Remove large payload logs from media and translator paths, pair object URL and
AudioContext creation with teardown, dispose VITS/PDF resources, make
stableDiff reference-image loading settle on corrupt inputs, and bound the
stage-4 image-generation and inlay-decode media paths that match the same
abort/cap family.

This slice owns the media/file sites named below. It may include I16 and I17
because they are the same log sweep. It does not own unrelated object URL
inventory items I13/I14 unless already touched incidentally, nor does it
change media encoding, provider payload shape, TTS voice routing, or
Playground subtitle UX beyond lifecycle cleanup.

The v4 routing is limited to named media invariants: v4-L31 rides only as the
abortable post-generation/imggen poll criterion, and v4-L36 rides only as the
model/proxy-supplied inlay image decode cap. Optional media lows outside
abort, cap, lifecycle, or log cleanup stay out of this slice unless explicitly
inventoried as no-action or measured/deferred.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L50-L55, K4, I16, and I17.
- `src/ts/process/stableDiff.ts`: image-generation payload logs, comfy
  poll-loop log, NAI reference-image resize/load, corrupt image handling, and
  v4-L31 comfy/wavespeed poll abort behavior.
- `src/ts/process/postGeneration/runStage4.ts`: v4-L31 stage-4 imggen
  entrypoint and submodel caption abort threading.
- `src/ts/process/files/inlays.ts`: `postInlayAsset` and `reencodeImage`
  object URL lifecycles, plus v4-L36 model/proxy-supplied image decode caps.
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
- [`../../../../audit-stability-and-performance-v4/audit-stability-and-performance-v4.md`](../../../../audit-stability-and-performance-v4/audit-stability-and-performance-v4.md):
  v4-L31 and v4-L36.

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
- Thread the live stage-4 abort signal into imggen post-generation work when
  included in the runtime pass: submodel caption calls and comfy/wavespeed
  poll loops must observe abort, clear poll timers, and avoid continuing after
  Stop or chat switch.
- Add an inlay image decode cap for model/proxy-supplied images before they
  can force full-resolution main-thread canvas work. The cap may be byte,
  dimension, pixel-count, or decode-policy based, but hostile oversized inputs
  must fail with a clear media error instead of hanging or OOMing the renderer.
- Inventory every media blob/object URL, audio context, synthesizer, PDF
  document, poll timer, image decode, cache, and debug-log site added to this
  slice. Each live site must be fixed, explicitly no-actioned with reason, or
  measured/deferred with an owner note in the slice proof.
- Register L50, L51, L52, L53, L54, L55, and K4 as `DONE` in the v3 gate and
  flip only those scheduled rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).
  Mention I16/I17 in proof text if they ride, without inventing scheduled
  status rows. Record v4-L31/v4-L36 coverage in proof text without adding
  unrelated v3 status changes.

## Invariants

- Media bytes, image resizing, prompt/provider payloads, subtitle conversion
  output, and TTS playback behavior stay unchanged on success.
- Object URLs are revoked only after the consuming operation has completed or
  failed.
- Shared AudioContext reuse must handle closed or suspended contexts.
- Resource cleanup must run on both success and failure paths.
- No default log path may print base64 media payloads, raw audio buffers, full
  translator notes, or transfer-sized provider bodies.
- Poll loops and async media calls that receive an abort signal must stop
  promptly and clear timers/listeners.
- Model/proxy-provided images must be bounded before expensive renderer-side
  decode/downscale work.

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
- If the runtime pass includes v4-L31, Stop/chat-switch aborts stage-4 imggen
  submodel captions and comfy/wavespeed polls, with no leaked poll timers.
- Model/proxy-supplied inlay images above the decode cap fail cleanly before
  unbounded main-thread canvas work.
- The slice proof records the media blob/audio/timer/decode/cache/debug-log
  inventory, including any explicit no-action or measured-deferred entries.
- L50-L55 and K4 are registered as `DONE` in the v3 gate and active-risk
  table, with I16/I17 proof text if they ride and no unrelated ID status
  changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/process/files/tests/inlays.test.ts \
  src/ts/process/postGeneration/runStage4.test.ts \
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
