# Phase 7 Prompt Assembly - 7-12d-ii

Date: 2026-05-24

7-12d-ii exposed the 7-12d-i mutation contract to the browser as
`message_patch` and added the browser-side applier needed before local
dispatch can use server prompt assembly.

## Landed

- `/api/v1/generate/chat` now emits `message_patch` immediately after a
  successful `prompt` event.
- `MessagePatchEvent.patch` is typed on both the Fastify and browser SSE
  mirrors.
- `requestServerChat` collects `message_patch` events and returns them with
  the assembled prompt.
- `applyServerMessagePatch` handles append and replace-all message
  mutations plus chat `scriptstate` deltas.
- `sendChat` can use server prompt assembly behind
  `db.useServerPromptAssembly`, apply patches, and continue into local
  `dispatchRequest`; provider dispatch from `/chat` remains deferred.
- Server user-message append is idempotent when the persisted chat already
  contains the browser-added last user row.

## Watch Points

- Explicit regenerate intent is still folded through the existing send-like
  browser path; 7-12d-iii-b should revisit this while wiring generation
  IDs, rerolls, and enriched `done`.
- The browser applier intentionally ignores `additionalSystemPrompt`
  mutations because the server prompt payload already includes those rows.
- `/chat` still does not emit provider tokens; that is the 7-12d-iii-a
  pickup.

## Verification

- `pnpm check` clean.
- `pnpm test` 622 tests plus 4 skipped.
- `pnpm api:test` 887 tests.
- `pnpm build` passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and bundle-size warnings.
