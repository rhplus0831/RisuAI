# Architecture

Date: 2026-05-25

This doc describes the target shape of the Fastify server and the
boundaries between it and the browser client. Current route coverage
lives in [`coverage/server-routes.md`](coverage/server-routes.md);
modules marked by later phases are target layout, not current
implementation.

## Server module layout

```
server/fastify/
  src/
    index.ts            entry point; reads env, builds app, listens
    app.ts              Fastify app factory; plugins, resources, routes
    config.ts           env loading and validation
    db.ts               node:sqlite handle, WAL pragma, schema metadata
    auth.ts             password + signed-assertion auth
    http.ts             shared auth/header helpers
    repository.ts       db.json, assets, backups now; SQL domain repo later
    proxy.ts            generic proxy helpers
    streamJobs.ts       proxy stream-job registry + local URL guard
    routes/
      health.ts
      auth.ts
      bootstrap.ts
      save.ts
      assets.ts
      backups.ts
      proxy.ts
      streamJobs.ts
      hub.ts
      legacyStorage.ts
      generation.ts       POST /api/v1/generate/completion
      generationChat.ts   POST /api/v1/generate/chat + preview-prompt
    generation/
      frames.ts           shared completion result/frame types
      additionalParams.ts body/header overlay helper
      echo.ts             deterministic developer provider
      openai.ts           OpenAI-compatible chat completions
      anthropic.ts        Anthropic Messages-compatible dispatch
      bedrock.ts          AWS Bedrock Claude dispatch
      cohere.ts
      gemini.ts
      horde.ts
      kobold.ts
      mistral.ts
      ollama.ts
      oobaLegacy.ts
      openaiLegacyInstruct.ts
      openaiResponses.ts
      sigv4.ts            Bedrock signing helper
      vertexAuth.ts       Vertex AI service-account JWT exchange
    events.ts           SSE event bus (planned Phase 9)
    tokenizer.ts        tiktoken + web-tokenizers encoders (planned helper)
    generate/
      router.ts         POST /api/v1/generate/* routes
      providers/        one file per provider family
      streaming.ts      SSE forwarder + abort propagation
    prompt/
      sseEvents.ts        9-event chat SSE taxonomy
      variables.ts        server-side risuChatParser adapter
      promptScope.ts      active prompt scope singleton
      cbsAdapter.ts       CBS callback adapter over promptScope
      promptVariablesBoot.ts one-time parser backend wiring
      staticSections.ts   description, author note, persona, cot
      plainSections.ts    main/jailbreak/globalNote sections
      history.ts          history shaping through multimodal inlays
      scripts.ts          regex script chain used by prompt leaves
      modules.ts          active module regex/assets helpers
      assemble.ts         prompt assembly root
      lorebook.ts         activation, recursion, depth helpers, budget filter
      templates.ts        complete prompt-template renderer
      tokens.ts           minimal tiktoken helpers for budget accounting
      tokenizerConfig.ts  shared tokenizer option helper
      preflight.ts        template-wide token preflight
      budgetFinalize.ts   final request budget pruning
      triggerVars.ts      trigger variable engine
      triggerDataEffects.ts  V2 safe data helpers
      triggers.ts         Phase 7-safe trigger runner
    memory/
      hypav3.ts         server-side Hypa V3 adapter
      jobs.ts           async embedding + summary queue
    media/
      translate.ts      DeepL, DeepLX, Google
      tts.ts            OpenAI, ElevenLabs, NovelAI
      image.ts          DALL-E, Stability, etc.
    plugins/
      mcp.ts            MCP trust gate (no execution yet)
    util/
      http.ts           shared fetch helpers
      errors.ts         typed errors with HTTP mapping
```

Keep the router files thin: they validate input and call into the
matching module. Persistence and business logic live in the modules,
not the route handlers.

## API surface

Routes are versioned at `/api/v1/`. Verb choice follows REST: `POST`
creates or invokes, `PATCH` partial updates, `PUT` replaces a child
collection, `DELETE` removes, `GET` reads. Revision-tracked
domain-state mutations return the new server revision; backup
create/delete, auth setup/login, and the Phase 3 legacy storage
compatibility routes are administrative or bridge operations and do
not bump revision. Every future event includes the revision it
represents.

Implemented route families are tracked in
[`coverage/server-routes.md`](coverage/server-routes.md). At a high
level, the current Fastify API covers:

- Health, auth, bootstrap, JSON save import, assets, backups, optional
  static SPA serving, and legacy storage compatibility.
- Proxy fetch, stream-job WebSocket, and Risu hub passthrough.
- Auth-gated completion generation and chat / preview-prompt generation.
- Phase 8 memory job surfaces as they land.

Planned later, with final shapes locked phase by phase:

- `GET /api/v1/events` - persistent SSE stream of committed mutations.
- `POST /api/v1/commands/<resource>[/...]` - typed commands per resource
  family; no whole-state PUT.
- Helper generation routes for translate, TTS, image, token counting, and
  encodings where the server owns the provider path.
- `.risu` export, bundle export, and multipart `.risu` import in Phase 9,
  after the server owns the final per-resource schema.

Conscious differences vs the `move-to-fastify` branch:

- **No `PUT /api/v1/state/components`.** Bootstrap reads + per-resource
  command writes only. The whole-state save was a bridge; we are
  starting without it.
- **No `completion-with-assembly` indirection.** Once Phase 7 lands,
  `/api/v1/generate/completion` is what server-side prompt assembly
  hits internally; the browser hits a higher-level
  `/api/v1/generate/chat` that owns assembly + dispatch.
- **No group-chat commands.** Group chat is removed in Phase 0; no
  endpoint exists for membership patches.

## Persistence

- SQLite via `node:sqlite`, WAL mode, foreign keys on. One file at
  `data/risu.db`, no multi-tenant split. The Phase 1 schema lives
  here: `schema_version(id, version, revision)`. Auth currently
  lives in data-dir files, not in SQLite. **System state only.**
- Domain state lives in a single JSON blob at `data/db.json` during
  the migration window. Phase 2 ships this blob plus bootstrap,
  JSON import, assets, and backups against it. The blob carries a
  top-level `_version` integer for shape evolution. See
  [`phases/phase-2-storage.md`](phases/phase-2-storage.md) for the
  rationale.
- Per-resource SQL tables land in later server phases, when an
  extracted API defines the shape that resource actually needs.
  There are no actual Fastify users yet, so do not write compatibility
  migrations for intermediate Fastify shapes; update the current schema
  and import paths directly. When `db.json` is empty, it is deleted.
- Assets are stored on disk as `data/assets/<sha256>.<ext>`. Asset
  metadata (size, contentType) lives in `db.json.assets` during
  Phase 2 and moves into SQL when the asset API graduates.
- Backups are stored under `data/backups/<id>/` as a `db.json`
  snapshot plus a `manifest.json` listing the revision and uploaded
  asset count.

## Auth

Single-user. Password set on first run; subsequent calls present a
short-lived ES256 client-signed assertion. The browser keeps a
keypair in localStorage / IndexedDB; the server stores the password
at `data/__password` and SHA-256 hashes of known public keys at
`data/__known_public_key_hashes.json`.

This matches the legacy Express auth shape that existed before
Phase 3 deleted `server/node/`, with Fastify storing its files under
`RISU_API_DATA_DIR` instead of the legacy `save/` directory. We do
not redesign auth in this migration unless a concrete need surfaces.

## Events

Planned for Phase 9. `GET /api/v1/events` will be a persistent
Server-Sent Events stream of committed mutations. The client subscribes
once on startup and uses events to invalidate its in-memory projection.
Transport details live in
[`phases/phase-9-client-thinning.md`](phases/phase-9-client-thinning.md).

## Boundary rules

At the target state, the server owns:

- Persisted state. The browser never writes to localForage in
  server-backed mode.
- Provider API keys for fully server-owned flows. During the current
  migration window, the Phase 6 client adapter still reads the
  existing DB key fields and sends only the selected provider's key
  in the `/generate/completion` options body; bootstrap masking
  under `RISU_MASK_SERVER_KEYS=1` waits until the server owns every
  provider path a deployment needs.
- Outbound HTTP for generation providers covered by the
  server-backed adapter. Uncovered providers continue through the
  local browser dispatch path until a routed server slice lands.
- Prompt assembly, tokenization, lorebook activation, and Hypa V3
  memory after Phases 7-8 close. Today the Phase 7 variable,
  static-section, plain-section, history, script, module, lorebook,
  token/budget, trigger, template renderer, memory/cache card,
  `assemblePrompt`, and chat-route surfaces are server-side. Preview
  and preview-prompt can already use `/chat` behind
  `db.useServerPromptAssembly`; live send/continue/regenerate remain
  local until 7-12d adds mutation patches and provider dispatch.

Browser owns:

- Rendering, input, abort forwarding, focus, scroll.
- Local display state (typing indicators, partial-message render).
- Browser-only effects: TTS playback, image preview, inlay assets
  the user just dropped.
- The `sendChat` UI lease so two screens can't dispatch at once.

Out of scope (see `removed-and-out-of-scope.md`): group chat
membership, peer sync, plugin code execution server-side, Drive
sync, Risu Account Sync.

## Reference notes

- `move-to-fastify`'s `server/fastify/` tree is a worked example of
  the module split above. It is denser than we need (e.g. it ships a
  whole-state bridge, multiple compatibility shims, and group-chat
  commands). Use it to read concrete code, not to set the API
  contract.
- `risuai-metatron`'s `chat_generation/` split
  (`generation_validation`, `message_state`, `prompt_builder`,
  `prompt_sections`, `prompt_history`, `prompt_templates`,
  `prompt_budget`, `lorebook`, `tokenizer`, `providers`,
  `generation_lifecycle`, `postprocess`) is the closest existing
  template for Phase 5 + Phase 7's TypeScript shape.
