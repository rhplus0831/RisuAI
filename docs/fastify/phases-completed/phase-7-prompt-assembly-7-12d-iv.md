# Phase 7 Prompt Assembly - 7-12d-iv

Date: 2026-05-24

7-12d-iv closed the server-dispatched `/chat` side-effect and rollback
slice.

## Landed

- `/api/v1/generate/chat` now emits typed `side_effect` events with
  `kind: "tts"` after server-dispatched provider completion when
  `db.ttsAutoSpeech` is enabled.
- Provider transport errors after prompt/message metadata now include
  `error.restoration`, carrying the pre-dispatch chat message snapshot
  and scriptstate needed to undo server-applied browser mutations.
- The browser `/chat` generation adapter collects terminal side effects
  and restoration payloads without changing the existing terminal error
  reporting path.
- `sendChat` suppresses the old streaming TTS closeout on server-dispatch
  runs, applies server-sent TTS through the existing `sayTTS` path, and
  restores chat state before surfacing terminal provider errors.
- Route, adapter, message-patch, and server-backed fixture coverage now
  pin the TTS event and rollback boundary.

## Watch Points

- Phase 7 closeout should do one pass over docs and coverage to confirm
  no active 7-12d work remains before opening Phase 8.
- Image generation, Stable Diffusion, Hypa V3 memory progress, plugin /
  Lua hooks, NovelAI string flattening, and low-level trigger effects
  remain deferred.
- The rollback payload intentionally restores chat messages and
  scriptstate; other closeout side effects such as reroll bookkeeping are
  not modeled as Phase 7 restoration data.

## Verification

- `pnpm exec vitest run server/fastify/__tests__/generation.chat.test.ts --config server/fastify/vitest.config.ts`
- `pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts src/ts/process/request/tests/serverMessagePatch.test.ts src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
- `pnpm check` clean.
- `pnpm test` 639 tests plus 4 skipped.
- `pnpm api:test` 895 tests.
- `pnpm build` passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and bundle-size warnings.
