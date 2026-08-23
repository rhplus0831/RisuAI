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

- [ ] Inventory every settings-group and collection read by routed components,
  shared layout, effects, derived stores, and imported helpers.
- [ ] Record whether each read is needed to render, interact, mutate, generate,
  or only prefill an optional editor.
- [ ] Turn the validated inventory into a typed/testable manifest keyed by route
  or surface family.
- [ ] Add a static or test-time assertion that consumers declare their resource
  ownership. Document justified shared dependencies instead of copying them into
  every route.

### 5B. Minimal coherent shell resource

- [ ] Define the smallest authenticated shell read needed for theme/language,
  account/session chrome, sidebar, Phase 2 character summaries, and current
  selection.
- [ ] Preserve the atomic revision barrier only among fields that must appear as
  one coherent shell. Unrelated route resources must not delay shell rendering.
- [ ] Apply the shell behind the resource write guard and advance the applied
  revision only according to the established resource/event rules.
- [ ] Add exact response-shape and payload-size coverage.

### 5C. Route-scoped loader

- [ ] Load declared settings groups and collections when the current route needs
  them, using the existing granular reads.
- [ ] Load selected character and selected chat detail independently of unopened
  settings and preset collections.
- [ ] Add per-resource request deduplication, abort/supersession, request-start
  revision validation, status, retry, and cleanup.
- [ ] Keep shared revision barriers only for groups whose UI would be invalid if
  applied separately.
- [ ] Make direct deep links self-sufficient; they must not depend on resources
  left behind by a previous route.

### 5D. Invalidation, prefetch, and failure isolation

- [ ] Map command events to the smallest loaded resource or manifest family.
- [ ] Preserve authoritative full recovery on a true event gap without forcing
  every normal route read back into a global fan-out.
- [ ] Drop late responses from an older route or selection.
- [ ] Prefetch only the most likely next resource, and only when it does not
  compete with selected chat hydration or a readiness-critical request.
- [ ] Keep an optional resource failure local to its surface and retry action.

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
