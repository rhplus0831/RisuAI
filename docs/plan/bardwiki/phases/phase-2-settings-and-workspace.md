# Phase 2: Settings and Manual Workspace

Status: in progress.

Goal: make BardWiki manually usable through global settings and a chat-scoped
document workspace while autonomous model updates remain disabled.

## Progress

Slice 1 added the strict global `bardWiki` object to canonical server and
browser defaults and assigned it to the `memory` settings group. Generic
settings writes now validate the shared TypeBox contract and reject automatic
confirmation/canonical updates until their owning phase. The existing Memory
page has a lazy fifth BardWiki tab with accessible enablement, mode, budget,
selection, model-profile, and prompt-preset controls; unavailable autonomous
controls remain visibly disabled. English and Korean define the complete new
language contract, and the settings resource manifest owns the component's
provider, memory, and prompt-preset dependencies.

Slice 2 added a named BardWiki action to the active-chat overflow menu and a
lazy modal workspace. Opening it reads only the selected chat's document index;
document Markdown and version history stay behind their respective user
actions. The responsive index/detail layout exposes source metadata, linked
document aliases, Markdown, and version provenance, handles unavailable and
retry states, and closes instead of crossing a chat switch.

Slice 3 made the workspace writable through focused browser command adapters
and encrypted durable-outbox intents. Users can set safe per-chat enablement,
memory-mode, and token-budget overrides; create, rename, edit, and soft-delete
documents; and edit kind, path, aliases, context, review state, and Markdown.
Accepted, queued, failed, unavailable, and stale-version outcomes remain
distinct. Queued drafts stay guarded until settlement, while conflicts offer
both discard/reload and an explicit retry of the preserved draft against a
fresh version/hash fence. Per-chat automatic confirmation and canonical
updates remain rejected until Phase 5.

Validation on 2026-08-29:

```text
pnpm exec vitest run \
  src/lib/Setting/Pages/BardWikiSettings.svelte.test.ts \
  src/lib/Setting/Pages/OtherBotSettings.svelte.test.ts \
  src/ts/server/resourceManifest.test.ts \
  src/lang/index.test.ts
# 4 files, 77 tests passed

pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/databaseDefaults.test.ts \
  server/fastify/__tests__/settingsGroupParity.test.ts \
  server/fastify/__tests__/bardWikiRoutes.test.ts
# 3 files, 35 tests passed

pnpm check:server
# protocol, client-library, browser-smoke, and Fastify typechecks passed

pnpm exec vitest run --project frontend-dom \
  src/lib/ChatScreens/BardWikiWorkspace.svelte.test.ts
# 1 file, 2 tests passed

pnpm exec vitest run \
  src/lib/ChatScreens/BardWikiWorkspace.lazy.test.ts \
  src/ts/server/resourceManifest.test.ts \
  src/lang/index.test.ts
# 3 files, 57 tests passed

pnpm exec vitest run --project frontend-dom \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts \
  -t 'exposes a named menu'
# focused overflow-menu test passed

pnpm exec svelte-check --tsconfig ./tsconfig.json --output machine
# 6,627 files, zero errors and warnings

pnpm exec vitest run --project frontend-dom \
  src/lib/ChatScreens/BardWikiWorkspace.svelte.test.ts
# 1 file, 7 tests passed

pnpm exec vitest run \
  src/ts/server/bardWikiCommands.test.ts \
  src/ts/server/commands.test.ts \
  -t 'BardWiki|BardWiki durable commands'
# 2 files, 4 focused tests passed

pnpm exec vitest run --project frontend-dom \
  src/ts/server/pendingMutationOutbox.test.ts \
  -t 'allowlists the durable bridge route'
# all 120 durable-route allowlist cases passed

pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/bardWikiRoutes.test.ts
# 1 file, 6 tests passed
```

## Depends On

- Phase 1 authoritative resources and manual commands are complete.

## Scope

- Add BardWiki global defaults to the canonical server/client `memory` settings
  group or the exact Phase 0 owner.
- Add a fifth BardWiki tab to the existing Memory settings page.
- Extract the tab into a lazy `BardWikiSettings` component.
- Add controls for enablement, memory mode, context budgets, update policy,
  model/prompt references, and safe defaults, but clearly mark unavailable
  autonomous options until their phases land.
- Add a chat-scoped BardWiki workspace opened from the chat UI.
- Implement document tree/list, Markdown editor, create/rename/delete, aliases,
  kind/context/review metadata, versions, source inspection, and save conflicts.
- Add per-chat enabled/override controls using the Phase 1 command.
- Add loading, empty, conflict, offline/unavailable, accepted/queued/failed, and
  stale-resource states consistent with existing mutation UX.
- Add all visible strings under `src/lang` and accessible labels/keyboard
  behavior.
- Preserve mobile/responsive behavior and avoid eager loading the editor on
  unrelated routes.
- Optionally add `/settings/memory` as an alias while retaining
  `/settings/other-bots`; do not add nested URL state unless Phase 0 required it.

## Out of Scope

- Prompt injection.
- Confirmation jobs, model calls, or automatic document updates.
- Full graph visualization or live filesystem synchronization.

## Anchors

- `src/lib/Setting/Settings.svelte`
- `src/lib/Setting/Pages/OtherBotSettings.svelte`
- `src/lib/UI/LazyComponent.svelte`
- `src/lib/ChatScreens/DefaultChatScreen.svelte`
- `src/App.svelte`
- `src/ts/routerRoute.ts`
- `src/ts/routeComponentPreload.ts`
- `src/ts/server/settingsGroups.ts`
- `src/ts/server/resourceManifest.ts`
- `src/ts/server/commands.ts`
- `src/lang/en.ts`
- `server/fastify/src/routes/commands.ts`

## Implementation Slices

1. Settings-group keys, defaults, parity tests, and lazy BardWiki settings tab.
2. Chat entry point and read-only document/index/version workspace.
3. Manual create/edit/rename/delete and conflict/recovery UX.
4. Responsive, accessibility, lazy-loading, localization, and route/resource
   regression coverage.

## Invariants

- The settings tab configures behavior; it is not the primary per-chat editor.
- Opening Settings or Quick Settings does not require loading a chat corpus.
- Opening a chat does not eagerly fetch document bodies until the workspace or
  a body view needs them.
- Unsaved editor text is never treated as server-accepted state.
- Accepted, queued, conflict, and failed outcomes remain distinguishable.
- A stale save cannot overwrite a newer server or job version.
- English defines the complete language contract; other locales inherit safely.
- Existing Memory, TTS, Emotion Image, and Image Generation tabs keep their
  current selected-state and legacy-GUI behavior.

## Required Coverage

- Fifth-tab selection, horizontal overflow, `aria-pressed`, legacy accordion,
  lazy loading, and Quick Settings reuse.
- Settings-group client/server parity and secret masking boundaries.
- Workspace loading per chat and no cross-chat document leakage.
- Manual create/edit/rename/delete, optimistic conflict, queued intent, retry,
  discard/reload, and unsaved-change close guards.
- Keyboard and accessible names for tabs, tree rows, editor controls, and
  destructive confirmation.
- Mobile workspace behavior and chat switch cleanup.
- Localization contract.

## Validation

```bash
pnpm exec vitest run \
  src/lib/Setting/Pages/OtherBotSettings.svelte.test.ts \
  src/lib/Setting/Settings.svelte.test.ts \
  src/ts/server/resourceManifest.test.ts \
  src/ts/server/commands.test.ts \
  src/lang/index.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/settingsGroupParity.test.ts \
  server/fastify/__tests__/commands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Add and run focused BardWiki component/store tests. Use
`pnpm smoke:fastify-browser` if the chat workspace or settings shell changes
cross an existing browser-smoke boundary.

## Exit Criteria

- A user can configure BardWiki and manually maintain per-chat documents.
- No model calls occur from the feature.
- All state reloads from authoritative resources after refresh.
- Conflict and queued-mutation UX prevents silent data loss.
- Existing settings and Quick Settings behaviors remain covered.

## Risks

- `OtherBotSettings.svelte` is already large; adding the implementation inline
  would worsen loading and maintenance.
- A selected-chat editor inside Settings would create ambiguous ownership when
  routing or switching chats. Keep the workspace chat-scoped.
- Auto-saving Markdown without strong version preconditions could overwrite
  worker or second-session changes.
