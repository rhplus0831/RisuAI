# Phase 5: Route-Driven Hydration

## Outcome

Replace the all-or-nothing startup resource fan-out with one coherent minimal
shell read plus route-owned settings, collections, selected-character detail,
and selected-chat detail.

This phase starts after [Phase 3](03-startup-capabilities.md) and may run in
parallel with [Phase 4](04-deferred-runtimes.md).

## Existing APIs to reuse

- Client reads: `fetchServerSettingsGroup()` and `fetchServerCollection()` in
  `src/ts/server/resourceReads.ts`
- Initial loads and invalidation: `src/ts/server/resourceInvalidation.ts`
- Settings ownership: `src/ts/server/settingsGroups.ts` and
  `server/fastify/src/routes/commands.ts`
- Server granular reads: `server/fastify/src/routes/resourceReads.ts`
- URL classification/application: `src/ts/router.ts`
- UI ownership guides: `src/docs/svelte-ui.md`,
  `src/docs/svelte-navigation-ui.md`, and `src/docs/svelte-settings-ui.md`

Do not add overlapping read APIs until the existing granular endpoints have been
shown to lack a required contract.

## Starting ownership manifest

This table is a hypothesis to validate against actual component reads:

| Surface | Initial resources |
| --- | --- |
| App shell/sidebar | Display, language, sidebar, account, character summaries, current selection |
| Chat route | Selected character, selected chat, prompt owner, runtime/model settings, plugins |
| Provider/model settings | Providers, models, runtime |
| Appearance settings | Display, language, media |
| Memory/lore tools | Memory plus selected lore/detail resources |
| Module/plugin settings | Modules, plugins, plugin custom storage |
| Preset editors | Only the selected preset collection |

## Review slices

### 5A. Consumer inventory and manifest contract

- [x] Inventory every settings-group and collection read by routed components,
  shared layout, effects, derived stores, and imported helpers.
- [x] Record whether each read is needed to render, interact, mutate, generate,
  or only prefill an optional editor.
- [x] Turn the validated inventory into a typed/testable manifest keyed by route
  or surface family.
- [x] Add a static or test-time assertion that consumers declare their resource
  ownership. Document justified shared dependencies instead of copying them into
  every route.

#### 5A implementation record

The typed inventory lives in `src/ts/server/resourceManifest.ts`. It separates
shared app/settings/Playground shells, routed pages, deferred runtimes, and
first-use overlays. Route resolution composes those surfaces and merges repeated
requirements while preserving the audited purpose tags: `render`, `interact`,
`mutate`, `generate`, and `editor-prefill`.

Shared dependencies are inherited instead of copied into each route:

- every route inherits the app shell;
- settings routes additionally inherit the settings navigation shell;
- Playground routes additionally inherit the Playground shell;
- open character chats and the synthetic Playground chat compose the chat
  generation runtime;
- optional overlays and background/plugin/translation runtimes remain separate
  first-use or scheduled surfaces and do not become route render barriers.

The audit also found legacy top-level values that no granular settings-group
read currently owns: `selectedPersona`, `botPresetsId`, `modelPresetsId`,
`promptPresetsId`, `loreBookPage`, `personaPrompt`, `userIcon`, and `userNote`.
The manifest models them as standalone requirements so 5B/5C cannot
accidentally assume a settings-group endpoint returns them. The settings shell's
use of the complete `botPresets` collection solely to decide whether one legacy
navigation entry is visible is also recorded as a candidate for a smaller
projection, not folded into the app shell.

`src/ts/server/resourceManifest.test.ts` asserts that all declared consumer
paths exist, exact settings keys belong to their declared groups, every
canonical settings and Playground route maps to a surface, standalone gaps stay
explicit, shared requirements merge deterministically, and the app shell
contains no route collection, selected detail, chat detail, or inlay catalog.

Verification:

- `pnpm exec vitest run src/ts/server/resourceManifest.test.ts` — 43 tests
  passed.
- `pnpm test:affected` — the affected frontend lane passed; no server test was
  selected for the behavior-neutral client contract.
- `pnpm check` — zero errors and zero warnings.

### 5B. Minimal coherent shell resource

- [x] Define the smallest authenticated shell read needed for theme/language,
  account/session chrome, sidebar, Phase 2 character summaries, and current
  selection.
- [x] Preserve the atomic revision barrier only among fields that must appear as
  one coherent shell. Unrelated route resources must not delay shell rendering.
- [x] Apply the shell behind the resource write guard and advance the applied
  revision only according to the established resource/event rules.
- [x] Add exact response-shape and payload-size coverage.

#### 5B implementation record

`GET /api/v1/resources/shell` is an authenticated, read-only protocol route. Its
version-1 response contains one outer revision, an exact shell-settings
allowlist, and the complete existing Phase 2 character-summary envelope at the
same revision. The nested envelope deliberately retains its own version and
strict validator, and its revision must equal the outer shell revision.

The shell settings are limited to localization/account display name, initial
color/text theme and custom CSS, reduced-motion/height/sidebar sizing, direct
sidebar chrome, save-status visibility, initial bot-settings mode, developer
tools visibility, external-server warning behavior, and session keepalive. Chat
textarea sizes are not included; the GUI-size effect now tolerates a partial
shell projection and leaves those deferred values untouched. Legacy snapshots
that omit falsy shell switches receive canonical server defaults so every
successful response has the exact protocol shape.

The response excludes collections, provider credentials, selected character or
chat detail, prompt bodies, and the inlay catalog. The server reuses
`loadCharacterSummariesForRead()` rather than loading or stripping full rows.
`fetchServerShell()` validates the complete response before converting summary
rows to browser shell rows. `applyServerShellResource()` preflights both slices,
applies them together under `withServerResourceApply()`, records a dedicated
partial-settings shell revision without claiming a full settings read, and only
then advances the monotonic applied-resource cursor. It is intentionally not
wired into startup yet; 5C owns the loader/cutover and direct-deep-link work.

Verification:

- focused frontend shell protocol/read/apply/manifest/GUI-size coverage — 68
  tests passed;
- focused Fastify resource, payload-metric, and route-protection coverage — 35
  tests passed;
- affected frontend lane — 5,156 tests passed;
- affected Fastify lane rerun — 2,214 tests passed and one test skipped. The
  first combined run hit the existing same-millisecond ordering flake in
  `memoryWorker.test.ts`; its isolated rerun and the complete affected server
  rerun passed;
- `pnpm check` and `pnpm check:server` — passed.

### 5C. Route-scoped loader

- [x] Load declared settings groups and collections when the current route needs
  them, using the existing granular reads.
- [x] Load selected character and selected chat detail independently of unopened
  settings and preset collections.
- [x] Add per-resource request deduplication, abort/supersession, request-start
  revision validation, status, retry, and cleanup.
- [x] Keep shared revision barriers only for groups whose UI would be invalid if
  applied separately.
- [x] Make direct deep links self-sufficient; they must not depend on resources
  left behind by a previous route.

#### 5C implementation record (2026-08-25)

Authenticated startup now reads and atomically applies only
`GET /api/v1/resources/shell`. The router then resolves the typed resource
manifest before applying a route and independently hydrates the route's settings
groups, collections, standalone settings, selected character, selected chat,
and effective prompt owner. Post-route chat and prompt work retains the existing
readiness coordinator, while deferred runtime consumers can join an identical
route-owned request instead of issuing a second read.

The new standalone protocol and authenticated
`GET /api/v1/resources/settings/:setting` route close the audited top-level
settings gaps with an exact allowlist and `{ present, value }` projection. The
client resource state now tracks status, error, and revision per settings group,
collection, and standalone setting. The route loader keys in-flight work by the
canonical resource target, deduplicates callers with compatible request-start
revision floors, aborts superseded route work, rejects late selection results,
and exposes route-local retry and cleanup. Provider and model requirements are
canonicalized to the provider projection because that endpoint is the declared
superset, avoiding overlapping reads.

Only the shell retains a cross-field atomic barrier. Granular resources apply
independently behind the resource write guard. Chat-owned prompt hydration can
populate a non-global owner without replacing the legacy global compatibility
projection. Direct URLs are preserved until their requirements settle, and a
failed route shows a local error and Retry action without discarding the ready
shell.

### 5D. Invalidation, prefetch, and failure isolation

- [x] Map command events to the smallest loaded resource or manifest family.
- [x] Preserve authoritative full recovery on a true event gap without forcing
  every normal route read back into a global fan-out.
- [x] Drop late responses from an older route or selection.
- [x] Prefetch only the most likely next resource, and only when it does not
  compete with selected chat hydration or a readiness-critical request.
- [x] Keep an optional resource failure local to its surface and retry action.

#### 5D implementation record (2026-08-25)

Ordinary command events now invalidate only matching settings groups,
standalone values, collections, summaries, selected detail, chat/lore bodies,
or inlay data that the client has loaded. Shell-owned changes refresh the shell
summary projection. A true event gap, import/restore, or other destructive
lineage transition still performs the authoritative full refresh; normal event
traffic no longer recreates the startup fan-out.

Route generations and selection-aware request keys fence late responses. The
catalog, desktop-sidebar, and pinned-chat surfaces use nonblocking pointer or
focus intent to prefetch the most likely character detail. Matching navigation
promotes and joins that request instead of aborting and restarting it. Settings
and Playground navigation intent similarly warms the exact manifest resources
and code chunk. After optional startup settles, a data-saver-aware idle queue
warms at most three pinned/recent likely character details sequentially. First
inlay navigation still loads the catalog through the same manifest path. Plugin,
background-effects, and chat-generation bootstrap owners also declare and ensure
their deferred manifest surfaces, so their dependencies remain explicit without
becoming shell render barriers. Joined deferred work retries if its route-owned
request was aborted.

The Fastify browser smoke asserts that aggregate settings, collections,
characters, and inlay reads are absent from initial shell startup, while the
required granular reads appear as routes and generation capabilities need them.
It also covers route-local offline retry, stale resource recovery, direct
startup paths, active-chat prompt ownership, and cold/warm cache behavior.

## Verification

- Manifest ownership assertions for shell and every route family.
- Client read/invalidation tests for deduplication, cancellation, revision races,
  event gaps, and isolated retry.
- Server resource-read tests for exact group/collection/shell shapes.
- Empty-cache browser deep links into chat, every settings family, Playground,
  memory/lore, plugin/module, and preset editors.
- Network assertions that unopened settings groups and collections are absent
  from startup.
- Route-change tests proving late data cannot apply to the new route.
- `pnpm test:affected`, plus `pnpm build:smoke` and targeted browser smoke at the
  phase milestone.

## Exit gate

- The chat route does not fetch unrelated settings or preset collections.
- Direct deep links fetch all and only their declared requirements.
- Unrelated route resources do not share a global render barrier.
- Optional resource failure does not invalidate already-ready capabilities.

All exit-gate conditions are met.

## Completion verification (2026-08-25)

- `pnpm test:affected --include-smoke` — 337 frontend files / 5,173 tests and
  59 Fastify files / 1,558 tests passed; one Fastify test skipped; the smoke
  build and all 25 browser tests passed.
- `pnpm check` — zero errors and zero warnings.
- `pnpm check:server` — passed.
- `pnpm format:check` — passed.
