# Phase 2: Settings and Manual Workspace

Status: in progress.

Goal: make BardWiki manually usable through global settings and a chat-scoped
document workspace while autonomous model updates remain disabled.

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
