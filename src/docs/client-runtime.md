# Client Runtime Guide

Last audited: 2026-07-10.

This file covers browser TypeScript areas that influence visible Svelte UI. For
component ownership and UI triage, start with `src/docs/svelte-ui.md`.

The runtime is Fastify-backed. The browser keeps a projection of server state in
`DBState.db`, renders Svelte UI from that projection, sends command mutations to
Fastify, listens for events, and hydrates large resources such as chat messages
on demand.

## Client TypeScript Areas

| Path                                                                                                                                                                           | Runtime ownership                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/ts/server/`                                                                                                                                                               | Fastify browser adapters: bootstrap, commands, projection resources, hydration, events, active writer, assets, backups, Realm import, memory job events, message translation refresh, bridge watchers, push notifications, projection/stale-operation guards, protocol diagnostics, smoke hooks. |
| `src/ts/storage/`                                                                                                                                                              | Browser projection database, server-backed auth/storage compatibility, `.risu` helpers, backup helpers, and auto-storage selection.                                                                          |
| `src/ts/process/`                                                                                                                                                              | `sendChat`, server-backed generation bridge, durable reattach, files/MCP/memory/embedding/post-generation helpers, retained parity helpers.                                                                  |
| `src/ts/process/request/`                                                                                                                                                      | Provider/server-routing classifiers, chat/completion/memory request adapters, SSE parsing, message patch helpers.                                                                                            |
| `src/ts/model/`, `src/ts/horde/`                                                                                                                                               | Browser model registry, durable profile records/resolver/UI state, and provider catalog helpers used by settings and generation preflight.                                                                   |
| `src/ts/plugins/`                                                                                                                                                              | Browser plugin loading/runtime and Plugin V3 API host. Fastify stores plugin records but does not execute plugins.                                                                                           |
| `src/ts/process/mcp/`                                                                                                                                                          | Browser MCP clients, internal tools, Risu access tools, and plugin MCP clients.                                                                                                                              |
| `src/ts/media/`, `src/ts/parser/`, `src/ts/gui/`, `src/ts/setting/`, `src/ts/translator/`, `src/ts/network/`, `src/ts/kei/`, `src/ts/util/`                                    | Focused helper domains that feed visible UI and tests.                                                                                                                                                       |
| `src/ts/stores.svelte.ts`, `src/ts/globalApi.svelte.ts`, `src/ts/characters.ts`, `src/ts/characterCards.ts`, `src/ts/hotkey.ts`, `src/ts/lite.ts`, `src/ts/observer.svelte.ts` | Cross-cutting browser stores, compatibility helpers, hotkeys, lite mode, observers, and character/card utilities.                                                                                            |

Retained compatibility and parity helpers still exist under `src/ts/process/`,
but they are not a selectable browser-local runtime. `src/ts/platform.ts`
hard-codes Fastify mode.

## Startup Sequence

`src/main.ts` installs the router, mounts `App.svelte`, optionally installs the
Fastify browser smoke hook, calls `loadData()`, initializes hotkeys, and removes
the preloading element.

`loadData()` in `src/ts/bootstrap.ts` performs the visible startup work:

1. Fetch `/api/v1/bootstrap` through `fetchServerBootstrapProjection()`, which
   prepares and merges bootstrap body-cache payloads before returning the
   projection.
2. If the server has no database, initialize a fresh server database and refetch
   the read-only projection.
3. Apply the server database into `DBState.db`.
4. Seed selected character state from the projection.
5. Record hydrated lorebook coverage.
6. Cache the server command revision.
7. Enable the projection write guard.
8. Seed active generation jobs and active message translations, then start
   active message translation refresh and durable generation reattach.
9. Start selected-character shell hydration and await the selected shell.
10. Start chat message hydration and hydrate the active chat.
11. Start prompt-template hydration.
12. Start bridge patch lifecycle flushing.
13. Subscribe to server events.
14. If `DBState.db.notification === true`, enable chat-completion push
    notifications.
15. Load plugins.
16. Update color scheme, text theme, animation speed, height mode, error
    handling, and GUI size CSS variables.
17. Apply startup UI state such as `botSettingAtStart`.
18. Set `loadedStore`, start DOM observers, register dynamic models, run module
    update, and show TOS as needed.

Visible startup bugs often sit at the boundary between `loadedStore`,
`selectedCharID`, projection application, route application, and CSS variable
updates.

## Projection And Hydration

The browser should treat Fastify projection data as the source of durable truth.
Use command helpers for user mutations and bridge watchers for compatibility
paths.

Important files:

- `src/ts/server/projectionWriteGuard.svelte.ts` protects server-owned
  projection state from direct browser mutation.
- `src/ts/server/bootstrapBodyCache.ts` merges cached module/plugin body payloads
  advertised by bootstrap.
- `src/ts/server/commands.ts` sends revision-checked command mutations.
- `src/ts/server/events.ts` subscribes to `/api/v1/events`.
- `src/ts/server/projectionResync.ts` handles full or targeted resync after
  revision gaps.
- Grouped `settings.updated` events identify their group in `event.id`, so a
  contiguous reconcile merges only that group's projected fields. Events from
  older servers or retained history without a recognized group safely request
  a full bootstrap instead.
- `src/ts/server/chatMessageHydration.svelte.ts` hydrates active chat messages
  and transcript windows.
- `src/ts/server/characterShellHydration.svelte.ts` hydrates selected inactive
  character shell rows.
- `src/ts/server/chatGenerationSettingsProjectionGuard.ts` preserves a queued
  optimistic chat generation-settings value when a targeted character-row
  projection differs before that save settles.
- `src/ts/server/promptTemplateHydration.ts` hydrates stripped prompt-template
  and preset prompt bodies with owner-keyed state for selected/requested prompt
  presets.
- `src/ts/server/lorebookBridge.svelte.ts`, `chatBridge.svelte.ts`,
  `characterBridge.svelte.ts`, `promptTemplateBridge.svelte.ts`,
  `scriptDefinitionBridge.svelte.ts`, and `settingsBridge.svelte.ts` bridge
  visible UI state to command-backed server changes.

If a component shows stale or missing data, confirm whether the data is:

- absent from bootstrap by design;
- waiting on chat, lorebook, character shell, prompt template, preset, or
  module/plugin body-cache hydration;
- hidden by a route/store condition;
- optimistically changed but awaiting command confirmation;
- rolled back after command failure;
- overwritten by an SSE event or resync.

Detailed bootstrap, targeted projection, hydration, SSE reconcile, projection
write guard, and bridge watcher rules live in
`docs/structure/server-projection-and-bridges.md`.

Chat/message compatibility writes in `src/ts/chatCommands.ts` classify a list
change into the narrowest safe command: append, single-message update, prefix
truncate, single delete, or tail replacement after a known persisted anchor.
Fully hydrated incompatible edits can fall back to full replacement, but a
placeholder-bearing transcript is not broadly replaced. At send time,
`src/ts/process/sendChatContext.ts` assigns ids locally to missing rows in a
fully loaded transcript, but persists those backfilled ids only when they form a
contiguous suffix following a persisted anchor. Other shapes remain local for
that send.

Chat generation-settings saves are serialized per chat and optimistically
applied. While a save is queued,
`chatGenerationSettingsProjectionGuard.ts` prevents a differing targeted
`characterRow` merge from rolling the visible value back; this protection ends
when the save settles and does not replace full-bootstrap resync semantics.

Prompt template projection notes:

- Modern `DBState.db.promptPresets[].promptTemplate` is the normal owner for
  prompt-template data. Prompt Settings reads and edits the selected modern
  prompt preset first.
- `promptTemplateHydration.ts` can hydrate the selected/global owner or an
  explicitly requested prompt preset, such as a chat-scoped
  `generationSettings.promptPresetId`.
- Prompt-item events apply to the `parentId` preset row. Only an event for the
  currently selected owner may update the top-level compatibility mirror.
- `DBState.db.promptTemplate` is retained as a compatibility projection/mirror
  for legacy callers and bridge reconciliation. It should not be treated as the
  normal editing or generation owner when a modern prompt preset resolves.
- Legacy `botPresets[].promptTemplate` remains compatibility data for import,
  export, prompt diff, and explicit extraction into prompt presets; legacy bot
  preset selection does not normally apply it into the active top-level
  collection.

Model profile projection notes:

- `DBState.db.modelProfiles` and `DBState.db.modelRoleProfiles` are durable
  Fastify-backed fields. Client and server defaults normalize them, and command
  patches validate their record, role-binding, provider option, runtime option,
  and fallback-ref shapes.
- `DBState.db.modelRuntimeDefaults` is the profile-system runtime default
  store. It uses the same runtime option schema as profile `runtimeOptions`.
- Preset, split-preset, loadout, import, bootstrap, and projection paths
  preserve these durable fields while still accepting legacy flat data.
- Provider secret masking covers profile-local `apiKey` values by stable
  profile id. Masked placeholders are resolved server-side during settings
  writes.
- Settings -> Model has a live command-backed authoring UI. The shell edits role
  bindings, profile rows, runtime defaults, first-class provider fields,
  fallbacks, and profile-local secret placeholders through dedicated model
  profile commands. Legacy flat settings remain available behind Advanced
  Legacy Settings and as compatibility/conversion data.

## Async Freshness And Import Guards

`src/ts/server/staleStateGuards.ts` is the shared helper for browser async work
that must not apply after the user changes selection, projection refreshes, or a
newer operation supersedes it. It provides latest-operation tokens,
destructive-refresh epochs, attempted-field/list rollback helpers, and dirty
draft merge helpers used by command bridges and UI import flows.

Specialized guards under `src/ts/server/` cover current import and fetch
surfaces:

- `biasImport.ts`, `colorSchemeImport.ts`, `naiVibeImport.ts`, and
  `seperateParametersImport.ts` parse imported JSON and apply it only when the
  selected prompt preset, display scheme, provider/model context, or parameter
  slot still matches the captured snapshot.
- `nanoGPTDashboardFetch.ts` prevents stale NanoGPT balance/subscription fetches
  from persisting subscription state after the API key changes.
- `characterAdditionalAssetUpload.ts`, `characterEmotionUpload.ts`,
  `characterFolderImageUpload.ts`, `characterTtsAssetUpload.ts`,
  `moduleAssetUpload.ts`, `personaIconUpload.ts`, `promptPresetIconUpload.ts`,
  and `settingsMediaAssetUpload.ts` apply uploaded asset ids only if the current
  owner and field snapshots still match.

These guards are client-side freshness checks. Server persistence still happens
through asset upload routes, command helpers, or settings patches after the
freshness check passes.

## Generation Client

`sendChat` in `src/ts/process/index.svelte.ts` is the browser coordinator for
chat generation UI. In Fastify mode it uses server prompt assembly and server
provider dispatch.

Important files:

- `src/ts/process/index.svelte.ts` owns `doingChat`, `chatProcessStage`,
  active abort controller state, and the high-level `sendChat` coordinator used
  by `DefaultChatScreen.svelte`.
- `src/ts/process/request/providerCapability.ts` and
  `resolveServerPromptAssembly()` decide whether the selected request can run on
  the server.
- `src/ts/process/serverBackedSendChat.ts` builds server requests, maps legacy
  inlay ids to server asset refs, calls `/api/v1/generate/chat` or the preview
  route, applies server message patches, and returns terminal data.
- `src/ts/process/request/serverChat.ts` parses chat SSE frames:
  `job_accepted`, stage, prompt, patch, info, token, side-effect,
  post-generation progress, warning, error, and done.
- `src/ts/process/reattach.ts` uses bootstrap `activeGenerationJobs`, including
  job mode and regenerate target when present, to reattach the current chat to
  durable server jobs.

Durable sends such as send, continue, and regenerate set `durable: true` when
allowed. Disconnect detaches from durable jobs; abort/cancel uses the durable
DELETE path when a job exists. Terminal `postGeneration` data can advance the
revision cache, apply a server-owned `messagePatch`, render the inlay screen
over `finalText`, request `resendChat`, or surface an Agent Preset error as a
failed terminal result. Generation results are persisted server-side, so the
browser suppresses the old generation-result command in server-backed paths.

Agent Preset step instructions can place selected prepared inputs through
matching placeholders such as `{{currentUserMessage}}` and can consume an
eligible completed step output through `{{agent::outputKey}}`. Before-main
steps can reference earlier before-main dependency levels; after-main steps can
also reference completed before-main outputs. Missing, same-level, disabled, or
otherwise unavailable output references make the preset `incomplete`. The
settings UI surfaces that status, and server prompt assembly blocks it before
provider dispatch.

Generation profile resolution happens before provider dispatch. Durable profile
records can own selected model ids, request/wire model ids, provider
options/endpoints, profile-local API keys, runtime options, and fallback profile
refs. Role bindings can select profile mode, legacy mode, or supported inherit
mode. When no durable profile context applies, the resolver falls back to
legacy flat fields for compatibility. Static and legacy fallback model ids still
use the flat `staticModel` path. Memory summaries use memory-role profile
resolution, while memory embeddings remain outside chat profiles on the
Hypa/Voyage/custom embedding contract.

Active durable profiles with incomplete or unsupported status are generation
guardrails. Browser preflight and request dispatch reject them before fetch, and
Fastify generation routes reject them before accepting SSE/jobs or reaching a
provider adapter. Compatibility profiles without `providerId` can still
generate when routable, but unsupported `providerId` placeholders are preserved
for editing and blocked for active durable generation.

Server chat assembly is profile-bound. The browser sends raw chat inputs; the
server resolves the effective model-runtime config, overlays the selected
profile model/request model/provider options/runtime settings, materializes
chat-scoped Agent Preset readiness, jailbreak, prompt-preset module integration,
and sidebar toggle state, then budgets and dispatches with that profile context.
This keeps profile runtime defaults and profile overrides in the server path
instead of borrowing stale `db.aiModel` or legacy flat parameter assumptions.

Prompt-template assembly uses the same modern-owner precedence on browser
preflight/parity paths and server generation: chat
`generationSettings.promptPresetId`, then selected/global prompt preset, then
top-level compatibility fallback only when no modern owner resolves.

When generation UI is wrong, inspect both the Svelte surface
`src/lib/ChatScreens/DefaultChatScreen.svelte` and the runtime files above.

## Assets, Storage, Realm, Plugins, MCP

Assets:

- Single uploads go through `/api/v1/assets`.
- Bulk uploads go through `/api/v1/assets/bulk`.
- Browser helpers live in `src/ts/server/assets.ts` and
  `src/ts/globalApi.svelte.ts`.
- Visible asset URLs normalize to `/api/v1/assets/:id`.

Storage:

- `src/ts/storage/fastifyStorage.ts` backs `/api/v1/storage/*` compatibility
  endpoints.
- `src/ts/storage/autoStorage.ts` selects the server-backed storage adapter.
- `FastifyStorage` write/remove calls carry `risu-writer-session` and surface
  `423 active_writer_stale`; read/list/exists calls are authenticated read-only.
- `.risu` and backup helpers remain under `src/ts/storage/`, but device backup
  export/import helpers call server routes rather than browser-local storage.

Realm import:

- `src/ts/server/realmImport.ts` handles Realm character import, progress SSE,
  and projection reconciliation after commit.
- Visible Realm UI is under `src/lib/UI/Realm/`.

Push notifications:

- `src/ts/server/pushNotifications.ts` registers `public/service-worker.js`,
  fetches `/api/v1/push/vapid-public-key`, and creates/deletes subscriptions
  through `/api/v1/push/subscriptions`.
- `src/lib/Setting/Pages/Display/NotificationToggle.svelte` owns the visible
  setting flow. Startup re-enables push registration when
  `DBState.db.notification === true`.
- The worker is scoped to Web Push chat-completion notifications; it is not the
  old offline/share/file-handler service worker surface.

Plugins:

- Browser plugin code executes only in the browser runtime under
  `src/ts/plugins/`.
- Fastify stores plugin records/storage but does not execute plugin code.
- Plugin UI can register extra settings/menu/chat/floating controls through
  stores in `src/ts/stores.svelte.ts`.
- Ordinary non-MCP module `.risum` import is supported in Fastify-backed browser
  mode: the browser decodes the module envelope, uploads embedded assets through
  server asset helpers, and creates the module through command helpers.
  Supported source filename extensions are retained for upload. Non-empty
  unsupported legacy filename tokens are classified from
  PNG/JPEG/WebP/GIF/AVIF signatures, with PNG as the fallback upload type, while
  the original tuple filename stays in module metadata. A blank filename is
  passed through and defaults to PNG in the asset saver. `.risum` files
  containing MCP metadata are rejected; MCP module import/update remains blocked
  until it has a dedicated command-backed route.

MCP:

- Browser MCP clients and tools live under `src/ts/process/mcp/`.
- Playground MCP UI lives in `src/lib/Playground/PlaygroundMCP.svelte`.

## Runtime Risks For UI Work

- Direct `DBState.db` mutation can fail under the projection write guard or be
  lost on SSE/resync. Use command helpers or bridge utilities.
- Bootstrap may intentionally provide stubs. Active chat messages and lorebooks
  can hydrate later.
- Route effects run only after `loadedStore`; a pre-load store write may not
  mean the URL or visible shell has caught up.
- CSS variables are applied after projection and settings load. A theme bug may
  be runtime state, not component markup.
- Plugins can add visible menu items and buttons. Check plugin stores before
  assuming a component owns every visible control.
- Full-stack visible bugs often need `pnpm dev:agent` or browser smoke because
  unit tests with fetch mocks can miss auth, SSE, projection, and asset URL
  wiring.

## Verification Pointers

Use the smallest command that covers the touched area:

```sh
pnpm check
pnpm test
pnpm test:gates
pnpm coverage:ui-map
pnpm smoke:fastify-browser
```

For server TypeScript checks after client type changes that server imports use:

```sh
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
