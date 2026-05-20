# Next Steps

Date: 2026-05-20

Use this list to pick the next slice. Keep work batches narrow:
one proxy slice or one `sendChat` extraction slice at a time.

## Immediate

1. **Phase 3 - Proxy migration.** Port provider proxy, hub
   passthrough, and stream-job WebSocket behavior from
   `server/node/server.cjs` to Fastify.
   - Phase 3A (`POST /api/v1/proxy/fetch`) landed 2026-05-20. It
     covers the generic single-request upstream fetch behind
     `requireAuth` (ES256 only, matching every other Fastify
     route). The request / response header sanitization helpers
     live in `server/fastify/src/proxy.ts` and are reused by the
     stream-job slice next.
   - Remaining slices, in order: stream-job WebSocket
     (`POST /api/v1/proxy/stream-jobs` + WS upgrade + DELETE), hub
     passthrough (`ANY /api/v1/hub/*` with `x-risu-node-path`
     override), client rewiring (`globalFetch` / `fetchNative` ->
     the new Fastify endpoints), then Express deletion +
     `runserver` removal.
   - Keep the existing client contracts (`/proxy*`,
     `/hub-proxy/*`, `/proxy-stream-jobs`) working until the
     Fastify replacements are wired.
   - Do not port Sionyw / Account Sync branches; Phase 0 removed
     them.
   - Inventory and exit criteria live in
     [`../phases/phase-3-proxy.md`](../phases/phase-3-proxy.md).

2. **Phase 5 - sendChat extraction.** Phase 4 closed 2026-05-20
   with all 17 characterization fixtures landed; the harness is
   ready to defend an incremental refactor of `sendChat` into
   per-stage modules. Start with the smallest meaningful seam
   (e.g., move the auto-continue recursion or the response
   post-processing block) and run the focused fixture suite after
   each step:
   `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts`.
   Pick up the open notes from [`sendchat.md`](sendchat.md): the
   `doingChat` lifecycle (set on entry, never cleared on the success
   path), the format-dependent `pushPrompts` coalescer, and the
   author-note-at-end-of-prompt vs. "configured depth" doc gap.

## Completed Slices

- **Phase 0 removals - Group chat.** Done 2026-05-20. Single
  commit; the type narrowing forced types, runtime, and UI to
  land together. `isGroupChat` was preserved as a `false`
  back-compat shim for user scripts. See [`removals.md`](removals.md)
  for the as-landed inventory.

- **Phase 0 removals - Peer multi-user chat.** Done 2026-05-20.
  See [`removals.md`](removals.md) for the as-landed inventory.

- **Phase 0 removals - Risu Account Sync + Drive sync.** Done
  2026-05-20. Landed as a single commit. The `backuplocal.ts`
  helpers were preserved (moved to `src/ts/storage/backup.ts`) so
  the in-app local backup buttons keep working; the doc claim that
  those helpers "rode alongside the Drive code path" turned out to
  be wrong. See [`removals.md`](removals.md) for the as-landed
  inventory.

- **Phase 0 removals - Legacy memory engines.** Done 2026-05-20.
  Two commits: V3 decoupling (rename `supaMemoryKey` →
  `hypaV3Key` with migration fallback), then the bulk removal.
  See [`removals.md`](removals.md) for the as-landed inventory.

- **Phase 1 - Fastify foundation.** Done 2026-05-20. Adds
  `server/fastify/` with `config.ts`, `db.ts` (`node:sqlite` +
  `schema_version`), `auth.ts`, `http.ts`, health/auth routes,
  root `pnpm api:*` scripts, Vite `/api` dev proxy, and a vitest
  smoke harness.

- **Phase 2 - Server storage, import, assets, backups.** Done
  2026-05-20. Adds `GET /api/v1/bootstrap`, JSON
  `POST /api/v1/import/risusave`, raw asset upload/read/head/exists
  routes, backup create/list/restore/delete routes, static serving
  from `RISU_API_STATIC_ROOT`, and the Docker switch to Fastify on
  port 6002. No server-side `.risu` export/bundle or asset delete
  route exists in Phase 2.

- **Phase 4 - sendChat characterization scaffolding + first slice.**
  Done 2026-05-20. Adds the fixture loader, provider fake,
  snapshot harness, per-side-effect mocks, and three fixtures
  (`simple-send`, `preview`, `continue`). A small defensive guard
  on `parser.svelte.ts:506-507` (optional chaining of
  `selIdState` and `DBState.db.characters`) was needed so the
  module's top-level `$effect.root` does not throw at vitest
  teardown.

- **Phase 4 - second fixture slice.** Done 2026-05-20. Adds
  `regenerate` (multiline reroll), `provider-error` (upstream
  fail produces a `risuerror` chat message under
  `inlayErrorResponse: true`), and `auto-continue` (recursive
  `sendChat` call with `autoContinueMinTokens`). The `uuid` mock
  counter now resets between fixtures so snapshots are
  order-independent.

- **Phase 4 - prompt-shape slice.** Done 2026-05-20. Bumps the
  snapshot schema so `providerCalls` carries the normalized call
  records (mode + formated + opt-in flags) instead of just a
  count. Adds `author-note` (chat-level note lands at the end of
  the default `formatingOrder`) and `cache-point`
  (`automaticCachePoint` walk-back marks the last 3 user entries
  - only reachable through a `promptTemplate` with a `chat`
  card). All 8 prior fixtures were re-recorded.

- **Phase 4 - persona / lorebook / abort slice.** Done
  2026-05-20. Adds `persona` (db.personaPrompt merged into the
  leading system block by `pushPrompts`'s same-role coalescer),
  `lorebook-keyword` (one globalLore entry with `key: "cat"`
  activated by user message), and `client-abort` (pre-aborted
  AbortSignal short-circuits at `index.svelte.ts:1541`). Adds an
  `aborted: true` flag to the fixture schema; the test driver
  synthesizes a pre-aborted controller and threads its signal
  into `sendChat`.

- **Phase 4 - lorebook finisher + multimodal slice.** Done
  2026-05-20. Adds `lorebook-constant`, `lorebook-recursive`,
  and `multimodal-image`. The multimodal slice introduces a
  `vi.mock` of `src/ts/process/files/inlays` to return a canned
  PNG and stub `supportsInlayImage`. It also uses an
  `xcustom:::` model with `hasImageInput` + the `Unknown`
  tokenizer so token math runs offline.

- **Phase 3A - Generic provider proxy on Fastify.** Done
  2026-05-20. Adds `POST /api/v1/proxy/fetch` plus pure helpers
  in `server/fastify/src/proxy.ts` (timeout controller,
  `decodeRisuUrl`, `parseRisuHeader`,
  `normalizeForwardHeaders`, `filterResponseHeaders`). The route
  is scoped under `app.register` with a catch-all
  content-type parser so request bodies are forwarded as raw
  bytes for any content type. Auth uses the standard
  `requireAuth` (ES256 only, consistent with every other
  Fastify route). Tests in
  `server/fastify/__tests__/proxy.test.ts` cover auth gating,
  missing URL, status / body / filtered-header forward,
  request-side header stripping, `risu-header` JSON override,
  `risu-timeout-ms` -> 504, and multi-chunk SSE streaming.
  Express `/proxy` / `/proxy2` remain live; client rewiring is
  a later slice.

- **Phase 4 - memory + trigger close-out slice.** Done
  2026-05-20. Adds `hypav3-memory`, `editrequest-trigger`, and
  `editoutput-trigger` - the final three fixtures of the
  Phase 4 plan. `hypav3-memory` mocks `memory/hypav3` via
  `importActual`+override and pins `stages: [1, 2, 1, 3, 4]`.
  `editrequest-trigger` swaps the entire `scriptings` module
  (because the real one imports wasmoon at top level and
  wasmoon's `createRequire` rejects the happy-dom URL); the
  fake `runLuaEditTrigger` appends a marker entry on
  `'editRequest'`. `editoutput-trigger` uses a plain
  `customscript` regex of type `'editoutput'` and pins that
  the rewrite is applied inside the streaming loop before
  `runInlayScreen` sees the text. Phase 4 is now complete.

## Closed (do not reopen without a contract)

These choices are locked. Reopening means writing a short rationale
in this file and updating the relevant phase doc:

- Tauri stays as-is. Do not add or modify Tauri-specific code in
  Phase 0-9.
- Hub proxy stays. Do not delete `/hub-proxy/*` handling.
- No whole-state PUT in the Fastify API.
- Only Hypa V3 survives. Do not write code that re-introduces
  Supa / Hypa V2 / Hanurai.
- Fastify is ES256-only on authenticated routes. Do not add a
  password-header acceptance path to `requireAuth` or to any
  individual route. The password is only used during initial
  setup to register a client public key; subsequent requests
  authenticate via an ES256 assertion in the `risu-auth` header
  (or the matching query-string parameter for WebSocket
  upgrades). The Express proxy's `isAuthorizedRequest` /
  `checkProxyAuth` password-header path is not ported.

## Verification before closing a slice

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Tauri build is verified manually at phase boundaries, not
per-slice.
