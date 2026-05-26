# Phase 7 Slice 7B - Server Regenerate Assembly Semantics

Date: 2026-05-27

## Scope

- Added server-side regenerate transcript preparation before normal
  prompt assembly.
- `assemblePrompt` now consumes `regenerateMessageId`, verifies that an
  existing target is the latest non-user message, and truncates the
  working transcript with the same latest-response reroll semantics as
  the browser path.
- Added a `regenerate` message mutation source so the streamed
  `message_patch` can replace the browser transcript with the
  server-assembled regenerate transcript.
- Allowed the browser-command race where the replace-messages command
  has already truncated the persisted transcript before `/chat` loads it.

## Tests

- Added assembler coverage for valid regenerate truncation,
  non-latest-target rejection, and the already-truncated browser-command
  race.
- Added route coverage for streamed regenerate `message_patch` delivery
  and invalid regenerate target SSE errors.
- Re-ran focused browser request/patch tests to cover the added mutation
  source.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/generation.chat.test.ts
pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts
```

## Next

Continue with 7C: add `/chat` provider dispatch guards for local-only or
deferred provider families, including NovelAI text, NovelList, Ooba
OAI-compatible, plugin, and local provider families.
