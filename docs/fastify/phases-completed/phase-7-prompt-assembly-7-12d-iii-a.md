# Phase 7 Prompt Assembly - 7-12d-iii-a

Date: 2026-05-24

7-12d-iii-a added the provider-agnostic server chunk transport needed
before the browser send path can move fully onto `/chat`.

## Landed

- Added `emitProviderChunks`, a small transport helper that maps existing
  `CompletionStreamFrame` sources into chat SSE `token`, terminal `error`,
  and terminal `done` events.
- Added an internal `/api/v1/generate/chat` `dispatchProvider` hook so
  server tests can prove provider output ordering without adding a public
  request-body option or wiring browser orchestration yet.
- Preserved the successful assembly ordering:
  `prompt` -> `message_patch` -> `stage(prompt,end)` -> `info`; provider
  output begins only after that sequence.
- Added server-only tests for token accumulation, implicit terminal done,
  provider failures, abort suppression, and route-level token/error
  transport with fake provider sources.

## Watch Points

- Production `/chat` still does not call real provider dispatch. The hook
  is a route dependency for server wiring, not a browser-facing API.
- The terminal `done` payload currently carries only the accumulated
  `result` for the happy transport path. `generationId`,
  `generationInfo`, reroll metadata, and gate handling belong to
  7-12d-iii-b.
- `tts` side effects and `error.restoration` rollback remain deferred to
  7-12d-iv.

## Next

7-12d-iii-b should connect real provider dispatch to the internal
transport, update browser send orchestration to consume `/chat` token /
done / error events, add `generationId` and reroll accumulation, and run
the end-to-end server-backed fixture sweep.

## Verification

- `pnpm api:test` 893 tests.
- `pnpm check` clean.
- `pnpm test` 622 tests plus 4 skipped.
- `pnpm build` passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and bundle-size warnings.
