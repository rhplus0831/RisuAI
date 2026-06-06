# Slice: TTS Context And HF Retry Bounds

Phase: [7](../../phase-7-opt-in-subsystems.md). Findings: M18, L48. Runtime
change.
Status: done on 2026-06-06.

## Scope

Stop network-voice TTS playback from leaking `AudioContext`s and make the
HuggingFace 503 retry loop bounded while translating input at most once.

This slice does not own unrelated TTS provider payload logs or WebSpeech/VITS
behavior that does not construct an `AudioContext`.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M18 and L48.
- `src/ts/process/tts.ts`: `playAudio`, the gptsovits gain path, the
  HuggingFace `while (true)` loop, `sourceNode`, and `stopTTS`.
- Existing focused suite: `src/ts/process/ttsHooks.test.ts`.
- New focused test home: `src/ts/process/tts.test.ts`.

## Target Shape

- Replace per-playback `new AudioContext()` calls with either one lazily-created
  module-level context or a close-per-call lifecycle. The chosen shape must cover
  both `playAudio` and the gptsovits volume/gain path.
- If reusing a context, create a small helper that resumes a suspended context
  before playback and rebuilds it if it has been closed.
- Ensure `sourceNode.onended` disconnects/release nodes, and `stopTTS()` stops
  the active source without leaving stale node references.
- Keep postprocessor hook order and skip semantics unchanged for normal and
  gain-path playback.
- In the HuggingFace TTS case, translate `text` once before entering retry
  handling. Do not run `runTranslator` again after each server-controlled sleep.
- Replace `while (true)` with a bounded retry policy: explicit max attempts
  and/or max total wait. When exceeded, surface an error instead of sleeping
  indefinitely.
- Add tests with a stubbed `AudioContext` proving repeated playbacks hold at
  most one live context or close each context, the gain path follows the same
  lifecycle, `stopTTS` releases the source, HuggingFace 503 retries cap out,
  and non-English HF TTS calls the translator once.
- Register M18 and L48 as `DONE` in the v2 gate with focused tests, and flip
  both rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- TTS audio bytes, MIME type selection, postprocessor hooks, and provider
  routing stay unchanged on success.
- WebSpeech cancellation behavior remains unchanged.
- HuggingFace still honors a reasonable `estimated_time` retry delay within the
  configured cap.
- The gain path must keep volume behavior identical.

## Done Criteria

- [x] Repeated TTS playbacks cannot grow live `AudioContext` instances without
  bound.
- [x] `stopTTS()` stops playback and leaves no stale active source reference.
- [x] HuggingFace 503 retry handling translates once, caps attempts/wait, and
  reports failure instead of hanging forever.
- [x] M18 and L48 v2 gate entries point at real focused tests and the risk-map rows
  are `DONE`.

## Focused Proof

- `src/ts/process/tts.test.ts`:
  `M18: repeated network TTS playbacks reuse one AudioContext and release ended sources`
- `src/ts/process/tts.test.ts`:
  `M18: gptsovits gain path reuses one AudioContext and releases its gain graph`
- `src/ts/process/tts.test.ts`:
  `M18: stopTTS stops the active source and clears stale playback refs`
- `src/ts/process/tts.test.ts`:
  `L48: caps HuggingFace 503 retries and reports failure`
- `src/ts/process/tts.test.ts`:
  `L48: translates non-English HuggingFace TTS text once across retries`

## Validation

```bash
pnpm exec vitest run src/ts/process/tts.test.ts src/ts/process/ttsHooks.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
