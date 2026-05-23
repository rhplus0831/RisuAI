# Phase 7 Prompt Assembly - 7-12d-iii-b

Date: 2026-05-24

7-12d-iii-b moved the browser send path behind
`db.useServerPromptAssembly` from local provider dispatch onto the
server-dispatched `/chat` stream.

## Landed

- Added a server-local chat dispatch resolver that builds Phase 6 provider
  requests from the assembled prompt and persisted `Database` settings.
- `/api/v1/generate/chat` now dispatches production providers after
  successful send-like assembly when `db.useServerPromptAssembly` is
  enabled, while preserving the internal test hook.
- `/chat` emits additive `info.generationId`,
  `info.generationInfo`, provider `token` events, and enriched terminal
  `done` metadata for server-dispatched sends.
- Browser send-like calls now use `requestServerChatGeneration`, consume
  the `/chat` token stream, keep the existing response orchestration, and
  merge terminal generation metadata.
- The server-backed fixture sweep proves send-like calls avoid
  `/api/v1/generate/completion` and still preserve message output,
  generation metadata, stages, and `addRerolls`.

## Watch Points

- 7-12d-iv still needs the typed `tts` `side_effect` event and
  `error.restoration` rollback for failures after browser-visible
  mutations begin.
- Image generation, Hypa V3 memory, plugin / Lua hooks, NovelAI string
  flattening, and low-level trigger effects remain deferred.
- Server-side provider dispatch currently resolves from persisted
  database settings; unsupported browser-only flattening paths remain out
  of the Phase 7 closeout boundary.

## Verification

- `pnpm check` clean.
- `pnpm test` 635 tests plus 4 skipped.
- `pnpm api:test` 894 tests.
- `pnpm build` passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and bundle-size warnings.
