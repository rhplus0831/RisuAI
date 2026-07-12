# Client Runtime Guide

Last audited: 2026-07-13.

This file covers browser TypeScript areas that influence visible Svelte UI. For
component ownership and UI triage, start with `src/docs/svelte-ui.md`.

The runtime is Fastify-backed. The browser loads durable settings, collections,
and character rows through REST resources, renders Svelte UI from reactive
resource state, sends command mutations to Fastify, listens for invalidation
events, and fetches large bodies such as chat messages on demand.

## Client TypeScript Areas

| Path                                                                                                                                                                           | Runtime ownership                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/ts/server/`                                                                                                                                                               | Fastify browser adapters: runtime bootstrap, REST resource reads, resource state/invalidation, commands, hydration, events, active writer, assets, backups, Realm import, memory job events, message translation refresh, bridge watchers, push notifications, stale-operation guards, protocol diagnostics, smoke hooks. |
| `src/ts/storage/`                                                                                                                                                              | Server-backed auth/storage compatibility, resource-database accessors, `.risu` helpers, backup helpers, and auto-storage selection.                                                                            |
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

1. Fetch `/api/v1/bootstrap` for runtime metadata: initialization status,
   current revision, schema/asset information, active generation jobs, and
   active message translations.
2. If SQLite is uninitialized, issue the initialization command and refetch the
   runtime metadata.
3. Fetch `/api/v1/settings`, `/api/v1/collections`, and `/api/v1/characters` in
   parallel. Retry the complete set when their revisions do not match, then
   apply the consistent set to reactive resource state.
4. Seed selected-character state, reset body hydration, record already-resident
   lorebook coverage, and cache the common resource revision.
5. Enable guarded resource writes and command-event reconciliation.
6. Seed active generation jobs and active message translations, then start
   translation refresh and durable generation reattach.
7. Start chat-message hydration and fetch the active chat body.
8. Start bridge patch lifecycle flushing and subscribe to server events.
9. If the loaded `notification` setting is true, enable chat-completion push
   notifications.
10. Load plugins.
11. Update color scheme, text theme, animation speed, height mode, error
    handling, and GUI size CSS variables.
12. Apply startup UI state such as `botSettingAtStart`.
13. Set `loadedStore`, select the persisted character, start DOM observers,
    register dynamic models, run module update, and show TOS as needed.

Visible startup bugs often sit at the boundary between `loadedStore`,
`selectedCharID`, resource application, route application, lazy body reads, and
CSS variable updates.

## Resource State, Invalidation, And Hydration

Fastify is the source of durable truth. The browser composes a compatibility
database view from three reactive resources: settings, collections, and
characters. User mutations go through command helpers; successful commands and
SSE events invalidate concrete resources, which the browser refetches before
advancing its applied revision.

Important files:

- `src/ts/server/resourceState.svelte.ts` owns settings, collections, and
  character resource state and composes the compatibility database view.
- `src/ts/server/resourceReads.ts` reads `/api/v1/settings`, optional settings
  groups, `/api/v1/collections`, optional named collections,
  `/api/v1/characters`, narrow character order/selection resources, and
  individual character rows.
- `src/ts/server/hydrationReads.ts` reads chat-message, character-lorebook,
  legacy-preset, and prompt-preset-template bodies from concrete endpoints.
- `src/ts/server/resourceInvalidation.ts` maps command events to targeted REST
  reads and falls back to a consistent three-resource refresh for gaps or
  unknown/sprawling invalidations.
- `src/ts/server/resourceRefresh.ts` coalesces authoritative full refreshes after
  imports, restores, and replay gaps.
- `src/ts/server/resourceWriteGuard.svelte.ts` limits direct mutation of
  server-owned resource state to trusted compatibility paths.
- `src/ts/server/commands.ts` sends revision-checked command mutations.
- `src/ts/server/events.ts` subscribes to `/api/v1/events`.
- Grouped `settings.updated` events identify their group in `event.id`, so a
  contiguous reconcile refetches only `/api/v1/settings/:group`. Events from
  older servers or retained history without a recognized group safely request
  a full resource refresh instead.
- `src/ts/server/chatMessageHydration.svelte.ts` hydrates active chat messages
  and transcript windows.
- `src/ts/server/characterShellHydration.svelte.ts` hydrates selected inactive
  character shell rows.
- Accepted chat generation-settings commands return their canonical persisted
  value and reconcile it as a local resource effect, so the normal optimistic
  save needs no follow-up character read. The freshness guard still preserves a
  newer queued value against foreign or in-flight character responses.
- `src/ts/server/promptTemplateHydration.ts` hydrates stripped prompt-template
  and preset prompt bodies with owner-keyed state for selected/requested prompt
  presets.
- `src/ts/server/lorebookBridge.svelte.ts`, `chatBridge.svelte.ts`,
  `characterBridge.svelte.ts`, `promptTemplateBridge.svelte.ts`,
  `scriptDefinitionBridge.svelte.ts`, and `settingsBridge.svelte.ts` bridge
  visible UI state to command-backed server changes.

If a component shows stale or missing data, confirm whether the data is:

- absent from the settings/collections/characters response by design;
- waiting on a chat, lorebook, character row, legacy preset, or prompt-template
  endpoint;
- hidden by a route/store condition;
- optimistically changed but awaiting command confirmation;
- rolled back after command failure;
- superseded by an SSE-triggered targeted read or full resource refresh.

The concrete resource modules above are the authoritative guide for startup,
targeted invalidation, hydration, SSE reconciliation, guarded compatibility
writes, and bridge watchers.

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
applied. A successful response applies the server-normalized value and advances
the affected character-row revision without another GET. While a newer save is
queued, the generation-settings freshness guard prevents a differing
character-row response from rolling the visible value back. Foreign events,
replay, response loss, gaps, and missing local targets still use authoritative
resource invalidation.

Prompt template resource notes:

- A modern prompt preset's `promptTemplate` field is the normal owner for its
  prompt-template data. Prompt Settings reads and edits the selected modern
  prompt preset first.
- `promptTemplateHydration.ts` can hydrate the selected/global owner or an
  explicitly requested prompt preset, such as a chat-scoped
  `generationSettings.promptPresetId`.
- Prompt-item events apply to the `parentId` preset row. Only an event for the
  currently selected owner may update the top-level compatibility mirror.
- The top-level `promptTemplate` collection is retained as a compatibility
  mirror for legacy callers and bridge reconciliation. It should not be treated
  as the normal editing or generation owner when a modern prompt preset
  resolves.
- Legacy `botPresets[].promptTemplate` remains compatibility data for import,
  export, prompt diff, and explicit extraction into prompt presets; legacy bot
  preset selection does not normally apply it into the active top-level
  collection.

Model profile resource notes:

- `modelProfiles` and `modelRoleProfiles` are durable Fastify-backed settings.
  Client and server defaults normalize them, and command patches validate their
  record, role-binding, provider option, runtime option, and fallback-ref shapes.
- `modelRuntimeDefaults` is the profile-system runtime default setting. It uses
  the same runtime option schema as profile `runtimeOptions`.
- Preset, split-preset, loadout, import, and resource-read paths preserve these
  durable fields while still accepting legacy flat data.
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
that must not apply after the user changes selection, resource refreshes, or a
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
  and resource reconciliation after commit.
- Visible Realm UI is under `src/lib/UI/Realm/`.

Push notifications:

- `src/ts/server/pushNotifications.ts` registers `public/service-worker.js`,
  fetches `/api/v1/push/vapid-public-key`, and creates/deletes subscriptions
  through `/api/v1/push/subscriptions`.
- `src/lib/Setting/Pages/Display/NotificationToggle.svelte` owns the visible
  setting flow. Startup re-enables push registration when
  the `notification` setting is true.
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

- Direct compatibility-view mutation can fail under the resource write guard or
  be lost on a later REST refresh. Use command helpers or bridge utilities.
- Character resources intentionally provide message-free chat rows and can
  provide lorebook stubs. Active chat messages and lorebooks hydrate later from
  their concrete endpoints.
- Route effects run only after `loadedStore`; a pre-load store write may not
  mean the URL or visible shell has caught up.
- CSS variables are applied after resources and settings load. A theme bug may
  be runtime state, not component markup.
- Plugins can add visible menu items and buttons. Check plugin stores before
  assuming a component owns every visible control.
- Full-stack visible bugs often need `pnpm dev:agent` or browser smoke because
  unit tests with fetch mocks can miss auth, SSE, resource refresh, and asset URL
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
