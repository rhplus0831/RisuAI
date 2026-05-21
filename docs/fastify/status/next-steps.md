# Next Steps

Date: 2026-05-21

Use this list to pick the next slice. Keep work batches narrow:
one `sendChat` extraction slice at a time. Phase 3 closed
2026-05-21.

## Immediate

1. **Phase 5 - continue sendChat extraction.** Phase 5 is active
   through Phase 5-17. The landed slices already moved
   auto-continue, error handling, several post-generation helpers,
   output-trigger reuse, the non-streaming / streaming response
   loops, the final request-budget recheck, the character
   description assembly, the plain-prompt main / jailbreak /
   globalNote sections, prompt-template normalization, and the
   static prompt sections (author note, cot, persona, inlay-view)
   out of `index.svelte.ts`. The remaining work is now sliced in
   [`sendchat-slicing.md`](sendchat-slicing.md); take the first
   open Phase 5 slice, adding its Phase 4 fixture gate first when
   needed, rather than picking an unrelated tiny helper. Run the
   focused fixture suite after each step:
   `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts`.
   Preserve the current lifecycle invariant from
   [`sendchat.md`](sendchat.md): `sendChat` owns and clears the
   `doingChat` lease when it acquires it, including abort and error
   exits. Also keep the helper-level tests green for any module
   touched by the slice.

2. **Follow-up: hub-route session auth.** The Fastify hub route
   at `ANY /api/v1/hub/*` is gated by `requireAuth`, so on
   password-protected deployments browser-loaded resources
   (`<img src=hubURL/resource/...>`,
   `<iframe src=hubURL/hub/login>`) will 401 because the browser
   cannot send `risu-auth` on element-loaded requests. The
   accepted scoping decision (Phase 3D-Broad option (b)) was to
   ship the limitation and revisit when a session-cookie path
   is needed. Unguarded deployments are unaffected. The Express
   `/hub-proxy/*` was rate-limited but not auth-gated, so it
   did not have this issue. A later slice can either drop
   `requireAuth` from the hub route to match the Express
   behavior or add a session-cookie auth path.

## Completed Slices

- **Phase 5 - static prompt sections slice 17.** Done 2026-05-21.
  Extracted the author-note + chain-of-thought block (previously
  21 lines around `index.svelte.ts:283-303`) and the
  persona + inlay-view block (previously 24 lines around
  `index.svelte.ts:371-394`) into
  `src/ts/process/promptAssembly/buildStaticPromptSections.ts` as
  four pure functions: `buildAuthorNote`, `buildCotInstruction`,
  `buildPersona`, and `buildInlayViewInstruction`. Each returns
  `OpenAIChat[]` (0 or 1 entries) and the coordinator stages
  each push at the correct point in the `unformated` assembly so
  the relative `postEverything` ordering (cot before
  description/lorebook, inlay-view after) stays explicit at the
  call site. `buildCotInstruction` takes `usingPromptTemplate` as
  its only argument; everything else reads from `DBState` or the
  passed `currentChar` / `currentChat`. The `getAuthorNoteDefaultText`
  / `getPersonaPrompt` imports in `index.svelte.ts` were dropped
  along with the inlined logic. Helper test
  `src/ts/process/__tests__/buildStaticPromptSections.test.ts`
  covers 16 cases: author-note chat-note vs template-default vs
  empty (4), cot off / on / off-via-customChainOfThought /
  no-template-suppression-doesn't-apply (5), persona on / off
  (2), and inlay-view emotion (with images, empty images,
  feature-off) + imggen + viewScreen-none (5). All 19 sendChat
  fixtures stay green without re-recording; `index.svelte.ts`
  drops to 1543 lines.

- **Phase 5 - template-normalization slice 16.** Done 2026-05-21.
  Extracted the prompt-template clone, implicit `postEverything`
  insertion, and utility-bot forced template (originally lines
  273-319 of `index.svelte.ts`) into
  `src/ts/process/promptAssembly/normalizeTemplate.ts`. The
  coordinator call site is one line: a destructure of
  `{ promptTemplate, usingPromptTemplate }`. `usingPromptTemplate`
  intentionally reflects the user's *original* choice (so the
  forced utility template does not flip the downstream
  `usingPromptTemplate && ...` gates that key off whether the user
  opted into template mode). Two gate fixtures landed in the same
  slice:
  - `prompt-template-basic` (F4-A): template with persona,
    description, authornote, plain, chatML, chat - no explicit
    `postEverything`. `chainOfThought: true` so the implicit
    `postEverything` add is observable as the trailing cot system
    message in the snapshot.
  - `utility-bot-template` (F4-H): `utilityBot: true`, no user
    template, default `utilOverride: false`. Pins that the forced
    6-card template *replaces* the default `mainPrompt` /
    `globalNote` so `formated` shrinks to description plus the
    start-new-chat marker plus the user message. `inputTokens`
    drops from `233` (simple-send) to `30`.
  Helper test `src/ts/process/__tests__/normalizeTemplate.test.ts`
  covers eight branches: no template, implicit-postEverything add,
  postEverything-already-present, db state non-mutation,
  utility-bot forces template, utility-bot + `utilOverride: true`
  keeps user template, `utilOverride: true` with no template still
  forces the utility template, and non-utility passthrough. All 19
  fixtures stay green; `index.svelte.ts` is now 1580 lines.

- **Docker runtime dependencies.** Done 2026-05-21. Moved
  `@fastify/websocket` and `tsx` from `devDependencies` to
  `dependencies` in `package.json` so the Dockerfile's
  `pnpm install --prod --frozen-lockfile` in the `deps` stage
  resolves both packages before they are copied into the
  `runtime` stage. Verified by re-running the prod-only install
  in isolation: `node_modules/tsx/dist/cli.mjs` and
  `node_modules/@fastify/websocket/package.json` are present;
  dev-only deps (`svelte-check`, `vitest`) stay absent. The
  Dockerfile and `docker-compose.yml` are unchanged.

- **Phase 5 - extraction slices 1-3.** Done 2026-05-21.
  `3c5a92b2` extracted `evaluateAutoContinue` to
  `src/ts/process/autoContinue.ts`; `75e266f5` made
  `sendChat` own the `doingChat` lease it acquires and clear it in
  `finally`; `9c3713bb` extracted `reportSendChatError` to
  `src/ts/process/sendChatErrors.ts` with targeted tests.

- **Phase 5 - post-generation slices 4-8.** Done 2026-05-21.
  `a2162545`, `da124c9b`, `0f44c35f`, `bd152cdf`, and
  `bfa128b4` extracted desktop notification, IGP dispatch,
  stage-4 timing writeback, response-emotion handling, and
  imggen stable-diff dispatch under
  `src/ts/process/postGeneration/`, each with a focused test.

- **Phase 5 - plain-prompt sections slice 15.** Done 2026-05-21.
  Extracted the non-template main / jailbreak / globalNote
  assembly (gated by `!currentChar.utilityBot && !promptTemplate`)
  into `src/ts/process/promptAssembly/buildPlainPromptSections.ts`.
  The helper returns `{ main, jailbreak, globalNote }` as
  `OpenAIChat[]` and keeps the `@@role`-tagged `formatPrompt`
  closure internal. The coordinator gate stays at the call site;
  only the assembly body moved. Targeted test
  `src/ts/process/__tests__/buildPlainPromptSections.test.ts`
  covers `mainPrompt` only, `systemPrompt` with/without
  `{{original}}`, the empty-string fallback, `additionalPrompt`
  gated by `db.promptPreprocess` (three branches),
  `jailbreakToggle` on/off, `replaceGlobalNote` present/absent,
  and the `formatPrompt` `@@` / `@@@` / implicit-system parsing.
  All 17 sendChat fixtures stayed green without re-recording.

- **Phase 5 - description-assembly slice 14.** Done 2026-05-21.
  Extracted the leading character-description system message
  (`desc` + `additionalInformations` + `personality` + `scenario`,
  each run through `risuChatParser`) into
  `src/ts/process/promptAssembly/buildDescription.ts`. The
  coordinator now calls
  `unformated.description.push(await buildDescription(currentChar, currentChat))`,
  matching the seam style used by Phase 5-13's `promptBudget/`.
  Targeted test
  `src/ts/process/__tests__/buildDescription.test.ts` covers
  desc-only, personality / scenario combos, exact concat order,
  the `descriptionPrefix` gate on `db.promptPreprocess` (both
  branches), and a call-time-read check on `DBState`. All 17
  sendChat fixtures stayed green without re-recording.

- **Phase 5 - request-budget slice 13.** Done 2026-05-21.
  `1de94ca9` extracted the post-`editRequest` token recheck +
  `outputTokens` estimate into
  `src/ts/process/promptBudget/finalizeRequestBudget.ts`. The
  helper returns a discriminated ok / overflow result so the
  coordinator keeps ownership of the `throwError` exit. Targeted test
  `src/ts/process/__tests__/finalizeRequestBudget.test.ts` covers
  happy path, `outputTokens` clamp, removable-trim success,
  multimodal-only survival, and the no-trim-possible overflow.

- **Phase 5 - emotion/output/response slices 9-12.** Done
  2026-05-21. `3509972f`, `79ce8ce5`, `4424140e`, `d67543b2`,
  `7519c384`, `241a6f13`, and `d926228a` extracted char-emotion
  store helpers, LLM and embedding emotion fallbacks, collapsed
  outer emotion dispatch, deduped output-trigger handling, and
  moved the non-streaming and streaming response loops to
  `postGeneration/nonStreamResponse.ts` and
  `postGeneration/streamResponse.ts`.

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
  on `src/ts/parser/parser.svelte.ts:506-507` (optional chaining
  of `selIdState` and `DBState.db.characters`) was needed so the
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
  AbortSignal now short-circuits at
  `src/ts/process/index.svelte.ts:1435`).
  Adds an
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

- **Phase 3 closeout - Express deletion.** Done 2026-05-21.
  After every Express surface had been mirrored on Fastify and
  the SPA was targeting the Fastify routes, the Express server
  was removed in a single commit: deleted `server/node/`,
  removed the `runserver` script from `package.json`, and
  dropped the `express`, `express-rate-limit`, and
  `node-html-parser` dependencies. `pnpm api:test`,
  `pnpm test`, `pnpm check`, and `pnpm build` were all green
  before and after. Phase 3 is closed.

- **Phase 3D-Broad - Legacy NodeStorage surface on Fastify.**
  Done 2026-05-21. Two commits (server + client) plus a docs
  pass.
  - Server-side: new
    `server/fastify/src/routes/legacyStorage.ts` adds
    `GET /api/v1/storage/list`, `GET /api/v1/storage/read`,
    `POST /api/v1/storage/write`, and
    `POST /api/v1/storage/remove`. Files live under
    `${dataDir}/save/`, keys are hex-encoded utf-8 paths,
    write bodies flow through a scoped catch-all
    content-type parser as raw bytes. Adds
    `POST /api/v1/auth/crypto` as the sha256 hex shim that
    mirrors Express's `/api/crypto`. The Fastify
    static-serving index injection now sets both
    `globalThis.__NODE__ = true` and
    `globalThis.__FASTIFY__ = true` so every SPA self-host
    gate activates.
  - Client-side: `src/ts/storage/nodeStorage.ts` picks its
    endpoint set at module-load time based on
    `platform.isFastifyServer` (Fastify family routes vs the
    Express family). A `fetchAuthStatus` helper normalizes
    the two different auth-status response shapes
    (`{noPassword, authorized}` vs `{status}`) into the
    existing `unset` / `incorrect` / `success` enum.
    `removeItem` hex-encodes each key separately when on
    Fastify so the server can validate every `$$`-joined
    segment as hex.
  - Tests in `server/fastify/__tests__/legacyStorage.test.ts`
    cover auth gating, hex validation, write/read
    round-trip, empty read for missing key, utf-8 list
    decoding, single + many key removal, idempotent remove,
    and the crypto endpoint. The Fastify static test now
    asserts both flag injections.
  - Known limitation accepted in scope (b): the Fastify hub
    route keeps `requireAuth`, so browser-loaded resources
    on password-protected deployments will 401. The follow-up
    is in the Phase 3 entry above.

- **Phase 3D-Narrow - Client proxy / hub URL switchover.** Done
  2026-05-21. Two commits.
  - Server-side: `server/fastify/src/app.ts` lazily reads and
    caches `dist/index.html` on the first SPA request, injects
    `<script>globalThis.__FASTIFY__ = true;</script>` after the
    opening `<head ...>` tag, and serves the cached result from
    both `GET /` and the SPA fallback in
    `setNotFoundHandler`. `@fastify/static`'s auto-index is
    disabled. `static.test.ts` covers the injection.
  - Client-side: `platform.isFastifyServer` is derived from
    `globalThis.__FASTIFY__`; `platform.isWeb` now also
    excludes Fastify deployments. `globalApi.svelte.ts` URL
    builders prefer Fastify routes when `isFastifyServer` is
    true: `getProxy2Url` -> `/api/v1/proxy/fetch`; new helpers
    `getProxyStreamJobsCreateUrl` /
    `getProxyStreamJobDeleteUrl` / `getProxyStreamJobWsPath`
    replace the old `getProxyStreamJobBaseUrl` and target the
    `/api/v1/proxy/stream-jobs` surface. `characterCards.ts`
    `hubURL` becomes `/api/v1/hub`.
  - At this point in the chronology, Express (`isNodeServer`) and
    Tauri / web branches were otherwise untouched; the scope was
    the proxy + hub URLs only. `NodeStorage` and the other
    `isNodeServer`-gated paths still targeted Express endpoints
    until Phase 3D-Broad moved them to Fastify when
    `isFastifyServer` is true.

- **Phase 3C - Hub passthrough on Fastify.** Done 2026-05-20.
  Adds `ANY /api/v1/hub/*` (`server/fastify/src/routes/hub.ts`)
  forwarding to `config.hubUrl` (`RISU_HUB_URL` env, default
  `https://sv.risuai.xyz`). Mirrors the Express
  `hubProxyFunc` semantics: strip the `/api/v1/hub` prefix
  and append the suffix; honor `x-risu-node-path` as a
  complete URL override; drop host / connection /
  content-length / risu-auth / x-risu-node-path from the
  forwarded headers; set `origin` to the hub origin; strip
  `content-encoding` / `content-length` / `transfer-encoding`
  from upstream responses; follow exactly one 3xx redirect
  manually; return 502 on upstream connection failure. Adds
  the `hubUrl` field to `AppConfig` (with a `parseHubUrl`
  validator) and updates every existing test harness for the
  new required field. Tests in
  `server/fastify/__tests__/hub.test.ts` cover auth gating,
  GET path+query forward, POST body forward + origin rewrite,
  request header strip, response header strip, the
  `x-risu-node-path` URL override, single-redirect following,
  and the 502 failure path.

- **Phase 3B - Proxy stream-jobs (HTTP + WebSocket).** Done
  2026-05-20. Landed in two commits.
  - **3B-1** added the lifecycle module
    `server/fastify/src/streamJobs.ts`: a `JobRegistry` class
    (create / pushEvent / attach / detach / markDone / cleanup /
    deleteJob / tickGc), `sanitizeLocalTargetUrl`, timeout /
    heartbeat normalizers, and `runStreamJob`. The
    local-network host check is re-implemented over
    `node:net`'s `BlockList`, which (unlike the Express
    string-matching original) accepts IPv4-mapped IPv6
    addresses in both the dotted `::ffff:127.0.0.1` and the
    WHATWG-canonical `::ffff:7f00:1` forms.
  - **3B-2** added the HTTP and WebSocket routes in
    `server/fastify/src/routes/streamJobs.ts`:
    `POST /api/v1/proxy/stream-jobs`,
    `DELETE /api/v1/proxy/stream-jobs/:id`, and the WS upgrade
    at `GET /api/v1/proxy/stream-jobs/:id/ws`. The WS route is
    the single documented exception that accepts the ES256
    assertion via a `risu-auth` query-string parameter in
    addition to the header (so EventSource-style fallbacks can
    attach). `buildApp` now owns a `JobRegistry` instance,
    schedules `tickGc` on a 60 s `unref`'d interval, and tears
    the registry down via `onClose`.
  - Initially added `@fastify/websocket` as a dev dependency; the
    later Docker runtime-dependency follow-up promoted it to
    `dependencies`. Tests in
    `server/fastify/__tests__/streamJobs.test.ts` cover the
    lifecycle module (48 cases - URL allow/reject, buffering
    caps, GC, abort, `runStreamJob` round-trip) and
    `__tests__/streamJobsRoutes.test.ts` covers the routes (11
    cases - POST validation matrix, DELETE idempotency, WS
    happy path, query-param auth, 401, 404, pending-event
    flush). The WS tests use the plugin's `injectWS` with an
    `onInit` hook so the `message` listener is attached
    before any frames arrive.

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
  At this point in the chronology, Express `/proxy` / `/proxy2`
  remained live and client rewiring was a later slice. Phase
  3D-Narrow and the Phase 3 closeout later rewired the SPA and
  deleted Express.

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
- Hub proxy stays. Do not delete the Fastify `/api/v1/hub/*`
  passthrough. The legacy `/hub-proxy/*` route was removed with
  Express.
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
