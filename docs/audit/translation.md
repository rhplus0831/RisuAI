# Audit scope: Translation subsystem

Status: DRAFT 2026-07-23 — items tagged `UNVERIFIED` are being re-checked by
the point-check verification pass.

## Charter

**In scope:** the client+server translation pipeline (google endpoint, LLM
translator, multi-step translator presets), translation caches and their
invalidation signatures, per-chat translation settings, bilingual display
mode, server-owned auto-translation of generated messages, and translation
history slots.

**Out of scope:** generation itself (see
[generation-models.md](generation-models.md)).

Key code: `src/ts/translator/`, `server/fastify/src/translation/`,
`src/lib/ChatScreens/Chat.svelte` (translation triggers),
`src/ts/process/serverGeneratedMessageTranslation.ts`.

## Issue history

Newest subsystem — six workstreams landed 2026-07-20/21 (per-chat settings,
Send-Text-As-Is, bilingual grouping/emphasis, server auto-translate with
deferred push, multi-step LLM pipeline, input hooks), then the server-owned
auto-translation migration completed 2026-07-22 (`2bccceae1`): the server is
now the sole trigger+executor for generated-message auto-translation, holding
the `done.postGeneration` frame until translation settles or the defer cap
expires.

Defect classes seen: stale cache sharing between modes (signature missed a
site), concurrent-translation ordering (older job wins), hydration gaps for
server-side preset execution (`1e9488047`), bilingual pair rendering edge
cases (empty/visual-only pairs).

## Open items

- `VERIFIED-OPEN` (2026-07-23) **Greeting translation storage gap** — the
  fmIndex greeting never gets a persisted MessageTranslation:
  `supportsServerRawTranslation()` requires `idx >= 0`
  (`src/lib/ChatScreens/Chat.svelte:791`) while the greeting renders with
  `idx={-1}` (`DefaultChatScreen.svelte:2017`); the server includes it
  source-only and renders `entry.translated ?? ''`
  (`server/fastify/src/translation/rawMessageTranslation.ts:184`, `:204`), so
  `{{slot::historytrans::N}}` gets an empty greeting body. Blocked on
  deciding where a first-message translation is stored (greetings are
  character fields, not Message rows).
- `ACCEPTED` (soften only on complaint) — with `translatorType llm` +
  `translatorSendTextAsIs`, non-message `runTranslator` consumers hard-error
  by design since the client fallback was removed: Playground translation,
  HuggingFace-TTS pre-translation, `translateVox`/`jaTrans`.
- `ACCEPTED` (by design) — group-chat/auto-continue chains serialize on the
  prior message's translation hold; swiped-to never-translated alternates
  stay untranslated until manual translate.
- Low-confidence flake (unconfirmed, 1 of ~6 runs) — a settings edit ~1.5 s
  after switching translator type dispatched a stale value; suspected
  mount/hydration race in `TranslatorPresetSettings.svelte`. File only if
  re-observed.

## Invariants for new code

- **Any translation-affecting setting/field must feed
  `translatorPipelineSignature`** (`src/ts/translator/pipeline.ts`) — the
  single source feeding all four cache sites (client settings signature,
  `translateHTML` memo key, LLM cache key, server `translatorSettingsHash`).
  Miss one and modes silently share stale cache entries.
- The server imports `src/ts/translator/presets.ts`: that file must keep
  dynamic `await import(...)` and RELATIVE (non-alias) imports or the server
  typecheck breaks.
- Per-step model selection: `profileIdOverride`, not `fallbackProfileId`.
- `.risutl` v2 container for multi-step presets; trivial single-step presets
  still encode v1.

## Verification recipe

Live-verify translation/bilingual UI with NO API key: the free google
endpoint, keyless echo-model generation, in-page SSE tee, page-context
settings PATCH — full selectors and traps in memory
`translation-ui-live-verify-recipe`.

## Sources

Memory: `translation-cache-signature-sites`, `greeting-translation-storage-gap`,
`llm-as-is-client-fallback-migration`,
`translator-preset-server-import-and-profile-override`,
`translation-ui-live-verify-recipe`. Archive:
`.archived-docs/generation-and-models/translation-workstreams-2026-07-20-to-21.md`.
