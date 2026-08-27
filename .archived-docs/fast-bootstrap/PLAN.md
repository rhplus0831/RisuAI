# Fast Bootstrap Implementation Plan

## Goal

Reduce the time from navigation to a useful, interactive application shell while
preserving the Fastify architecture's core guarantees:

- the server remains authoritative;
- cached browser data is never presented as confirmed server state;
- pending mutations are replayed before ordinary writes are enabled;
- revisions remain monotonic and gap recovery remains correct;
- chat generation cannot start until its prompt, plugin, and chat dependencies
  are ready.

The implementation should adopt HaejeokRisuAI's most transferable ideas—small
entry bundles, progressive startup, thin initial records, and deferred optional
work—without copying its local-database assumptions. The server-driven design
allows a more aggressive end state: an authenticated, read-only observer shell
can eventually appear while writer ownership and mutation recovery continue in
the background.

## Current Baseline

The baseline is a fresh production build from the current source tree. These
numbers are diagnostic rather than permanent budgets:

| Measure | Current baseline |
| --- | ---: |
| JavaScript files module-preloaded by `index.html` | 25 |
| Initial JavaScript, raw | 5,727,944 bytes |
| Initial JavaScript, gzip | 1,629,868 bytes |
| Largest initial chunk (`database.svelte`) | 669,209 bytes gzip |
| Main entry chunk | 521,986 bytes gzip |
| Language chunk | 281,427 bytes gzip |

One representative local startup trace also showed the relative cost of the
initial resource aggregates:

| Response | Raw | Gzip |
| --- | ---: | ---: |
| Settings | 56,358 bytes | 13,498 bytes |
| Collections | 480,652 bytes | 94,595 bytes |
| Characters | 2,214,887 bytes | 710,202 bytes |

The trace is a sample, not a universal benchmark. It is useful because it makes
the first optimization target clear: the character list response is carrying
far more data than the first screen needs.

## Non-Negotiable Invariants

Every workstream must preserve the following behavior:

1. A queued client mutation is not treated as accepted server state.
2. Pending owner adoption, writer takeover, outbox preparation, receipt
   acknowledgement, and pending-mutation replay retain their current ordering.
3. Ordinary commands are rejected until mutation capability is explicitly
   enabled. UI disabling alone is not a sufficient guard.
4. A resource projection is applied only after authenticated server confirmation
   and a coherent revision check.
5. Resource event gaps continue to trigger authoritative recovery.
6. Character summaries never silently become authoritative character details.
7. Generation remains blocked until the selected character, chat, prompt
   template, plugins, and recovered generation state are ready.
8. Plugin accepted-projection behavior is unchanged when plugin loading moves
   later in startup.
9. First-run database initialization and internal outbox replay remain possible
   even while user-originated commands are blocked.
10. New user-visible status or error strings are added through `src/lang`.

## Target Startup Model

Replace the single overloaded `loadedStore` boundary with explicit capabilities.
The exact store representation can be refined during implementation, but the
semantic phases should be stable:

| Phase | Meaning | User-visible behavior |
| --- | --- | --- |
| `mounting` | Entry code and minimal shell are loading | Static loading surface |
| `observer-ready` | Authenticated read-only resources are coherent | Shell and lists may render; writes remain blocked |
| `writer-ready` | Writer ownership and pending mutation recovery are complete | Mutating navigation and commands may run |
| `chat-ready` | Selected character/chat, prompt owner, plugins, and recovery state are ready | Chat interaction and generation may run |
| `background-ready` | Push, model discovery, warnings, and optional runtime work have settled | No additional global gate |

Code should consume narrow selectors instead of comparing phase names wherever
possible:

- `canRenderShell`
- `canApplyRoutes`
- `canMutate`
- `canGenerate`
- `pluginsReady`

The first rollout is deliberately conservative: reveal the shell only after
writer recovery plus thin shell resources are ready. A later workstream enables
the more aggressive pre-writer observer shell after the capability guards have
proved reliable.

## Delivery Structure

The work is divided into reviewable workstreams. Bundle work and server resource
work may proceed in parallel after measurement is in place. Startup phase changes
should land only after the thin character projection exists, so the new visible
boundary does not expose the current oversized aggregate.

```text
WS0 Measurement and budgets
 ├── WS1 Entry and bundle boundaries ──────┐
 └── WS2 Thin character projection ────────┤
                                           v
                              WS3 Startup capabilities
                                 ├── WS4 Deferred runtimes
                                 └── WS5 Route-driven hydration
                                           |
                                           v
                              WS6 Pre-writer observer shell
                                           |
                                           v
                              WS7 Hardening and rollout
```

## WS0 — Measurement and Regression Budgets

### Objective

Make startup improvements measurable and prevent the initial preload graph from
silently growing again.

### Scope

- Add `performance.mark`/`performance.measure` points for entry, shell,
  observer, writer, chat, plugin, and background readiness.
- Expose the phase and timestamps through the existing browser-smoke surface in
  `src/ts/server/browserSmoke.ts`.
- Add a build report that parses the generated `index.html` module preloads and
  reports file count plus raw and gzip totals.
- Extend the server's existing bootstrap/resource response metrics rather than
  creating a separate timing system.
- Add cold-start and warm-start scenarios using both a small fixture and a large
  database fixture.

### Initial budgets

These are milestone budgets, to be ratified from variance measured across five
reproducible clean local production builds in this workstream:

- initial JavaScript: at most 900 KiB gzip;
- no initial JavaScript chunk larger than 500 KiB gzip;
- character summary response: at least 80% smaller than the current full
  character aggregate on the large fixture;
- no user-originated mutation before `writer-ready`;
- no generation before `chat-ready`.

If a numeric budget must change, the pull request should include before/after
artifacts and explain the dependency that makes the change necessary.

### Verification

- Unit-test phase timestamp ordering and one-time emission.
- Run the report against five clean local production builds from the same source
  revision and record their variance.
- Record cold and warm measurements separately; do not mix cached and uncached
  samples.

### Exit criteria

- A developer can reproduce bundle and startup measurements with one documented
  command.
- The documented local build-report command fails on a material initial-preload
  regression.
- Five local preload reports and their variance record are retained with the
  workstream evidence.

## WS1 — Entry and Bundle Boundaries

### Objective

Ensure the browser downloads and evaluates only the code needed to mount the
first useful shell.

### Implementation

1. Reduce `src/main.ts` to essential environment setup, shell mount, and startup
   orchestration.
2. Replace eager `core-js/actual` and polyfill imports with targeted feature
   detection. Dynamically import the streams and mobile drag/drop polyfills only
   on affected platforms.
3. Split `src/App.svelte` so settings screens, editors, playgrounds, import/export
   tools, and modal families are dynamically loaded when opened.
4. Split router URL parsing from route application. The lightweight parser may
   load at entry; character management, playground, persona, and other route
   handlers load only when a matching route is applied.
5. Untangle `src/ts/stores.svelte.ts` so root shell stores do not statically pull
   modules, scripts, and the complete resource-state graph into the entry.
6. Lazy-load `streamsaver` from the `LocalWriter` path in
   `src/ts/globalApi.svelte.ts`.
7. Remove static imports that make existing dynamic imports ineffective. Treat
   every Vite warning about a module being both static and dynamic as a concrete
   import-graph defect.
8. Add explicit Vite manual chunks only after the import boundaries are clean.
   Manual chunking must not be used to hide an eager dependency graph.
9. Evaluate self-hosting fonts and making noncritical KaTeX styling lazy only
   after JavaScript evaluation is no longer the dominant startup cost.

### Review slices

- WS1a: entry and conditional polyfills;
- WS1b: lazy root UI and route modules;
- WS1c: store/global API dependency cleanup;
- WS1d: final Vite grouping and budget enforcement.

### Verification

- Production bundle report after every slice.
- Browser smoke coverage for every lazy route and modal family.
- A first-open test for each lazy surface to catch missing CSS, transient blank
  states, and chunk-load failures.
- Offline chunk-load failures show a recoverable error instead of leaving the UI
  indefinitely suspended.

### Exit criteria

- The initial preload graph meets the ratified WS0 budget.
- No optional screen or export implementation is present in the entry graph.
- There are no unexplained static-plus-dynamic import warnings.

## WS2 — Thin Character Summary Projection

### Objective

Replace the full character aggregate used for the initial list with a stable,
small server projection, then hydrate details only for the selected character.

### Server implementation

1. Define a versioned character-summary response contract in the shared protocol.
2. Add a repository query that selects summary columns directly instead of
   calling `loadCharacterRowsForRead()` and stripping fields afterward.
3. Include only fields required by sidebar/list rendering and selection, such as:
   - `__serverCharacterShell`;
   - `chaId`, `type`, `name`, and display image reference;
   - trash, creation, modification, and last-interaction metadata;
   - explicitly justified count/latest-message metadata if the current list
     needs it.
4. Never include chats, message bodies, `globalLore`, Hypa data, or other detail
   payloads in this projection.
5. Preserve revision/hash authentication and return the projection at the same
   coherent resource revision as the other shell resources.
6. Add a detail endpoint or reuse the existing detail read for one character,
   with clear not-found and revision-race behavior.

### Client implementation

1. Produce records marked with `SERVER_CHARACTER_SHELL_MARKER` so the existing
   shell type checks become active production behavior.
2. Wire `startSelectedCharacterShellHydration()` into startup after the summary
   projection has been applied.
3. Hydrate only the selected character detail, deduplicate concurrent requests,
   and discard stale responses when selection changes.
4. Keep the shell object usable for list rendering while detail hydration is in
   flight.
5. On detail failure, preserve the list shell and present a retryable character
   error rather than invalidating all startup resources.
6. Ensure mutations against an unhydrated shell either load the detail first or
   fail with a typed readiness error.

### Verification

- Contract tests assert the exact allowed summary fields.
- Repository tests prove that chat/message/lore blobs are not selected or
  serialized.
- `src/ts/server/characterShellHydration.test.ts` covers selection churn,
  deduplication, stale responses, deletion, and retry.
- `src/ts/server/resourceInvalidation.test.ts` covers coherent revision apply and
  gap recovery with summary records.
- A large fixture demonstrates the WS0 response-size target.

### Exit criteria

- Initial character loading cost scales with summary fields, not chat history.
- Selecting a character hydrates one detail record without refetching the entire
  character list.
- Existing list and selection behavior is unchanged from the user's perspective.

## WS3 — Explicit Startup Capabilities

### Objective

Turn the sequential bootstrap into observable capabilities so the shell can
appear before chat-specific and optional work completes.

### Implementation

1. Introduce a startup coordinator with monotonic state transitions and narrow
   capability selectors.
2. Keep the writer-critical sequence intact:
   - pending owner adoption;
   - writer-intent bootstrap and takeover confirmation;
   - first-run initialization where required;
   - pending outbox preparation;
   - receipt acknowledgement;
   - pending mutation replay;
   - authoritative post-replay resource/revision refresh;
   - revision cursors, reconciler, and write guard installation.
3. Set `canRenderShell` after writer recovery and the thin shell resources are
   coherent. This is the conservative first release boundary.
4. Set `canMutate` only after the writer-critical sequence and post-replay
   refresh complete.
5. Set `canGenerate` only after selected character/chat hydration, prompt-template
   ownership, plugins, and generation recovery are ready.
6. Replace `loadedStore` consumers incrementally. Retain a temporary compatibility
   derivation until every call site has been assigned a specific capability.
7. Split the `App.svelte` route effect into shell rendering and route application.
   Route handlers that can persist selection must wait for `canApplyRoutes`.
8. Add a startup guard to `canUseServerCommands()` and to the resource
   compatibility facade. Allow only named internal bootstrap operations to bypass
   it.
9. Install the read-only resource write guard as soon as an early projection is
   visible, not at the end of bootstrap.
10. Start resource event subscription from the last coherently applied revision;
    cover events arriving during each phase.

### Failure behavior

- A phase failure records the failed capability and exposes a targeted retry.
- Losing writer access clears mutation/generation capabilities immediately but
  may leave an authenticated observer shell visible.
- Retrying one phase must not repeat already accepted mutations or register
  duplicate event listeners.
- A newer navigation or selected-character request supersedes older in-flight
  hydration work.

### Verification

- `src/ts/bootstrap.test.ts` covers phase ordering, retries, failure isolation,
  and cleanup.
- `src/App.routeEffect.dom.test.ts` proves that rendering may occur before a
  persistence-capable route effect.
- Command tests assert that direct programmatic calls cannot bypass
  `canMutate`.
- Resource-event tests inject changes between every transition and prove no
  revision is lost.
- Pending-outbox tests prove replay still precedes ordinary commands.

### Exit criteria

- The shell is visible without waiting for chat-only or optional background work.
- Every startup-sensitive action has an explicit capability gate.
- `loadedStore` is removed or reduced to a documented compatibility alias with a
  deletion issue.

## WS4 — Defer Optional and Context-Specific Runtimes

### Objective

Move work that is not required for the first visible shell behind the relevant
capability or actual feature use.

### Work to defer

- push coordinator initialization;
- plugin loading and runtime synchronization;
- recovered generation effects;
- selected prompt-template hydration;
- active chat body hydration;
- inlay catalog loading;
- dynamic provider-model discovery;
- DOM observers that are not required for initial layout;
- update checks and startup warnings.

### Dependency rules

- Plugins may load after the shell, but chat rendering/generation paths that use
  plugin providers, UI hooks, or output transforms wait for `pluginsReady`.
- Prompt-template hydration may load after the shell, but generation waits for
  the selected prompt owner.
- Chat bodies load for the selected chat only. A message skeleton is shown until
  `chat-ready`.
- Push failure never blocks shell, writer, or chat readiness.
- Inlay catalog failure affects only the inlay UI.
- Dynamic model discovery updates model choices after render and does not reset a
  valid current selection.

### Verification

- Unit tests for each dependency rule.
- Browser tests with deliberately slow and failed plugin, push, inlay, model, and
  chat endpoints.
- Confirm accepted plugin projections are not overwritten by late plugin startup.
- Confirm cleanup prevents duplicate timers, observers, and subscriptions on
  retry or remount.

### Exit criteria

- Optional endpoint latency cannot delay `canRenderShell` or `canMutate`.
- Chat readiness accurately identifies its remaining dependency instead of
  showing a generic global loading screen.

## WS5 — Route-Driven Resource Hydration

### Objective

Use the server's existing granular settings and collection endpoints so startup
loads only resources needed by the current route.

### Implementation

1. Inventory component ownership for every settings group and collection.
2. Define a minimal shell manifest. It should include only data needed by theme,
   language, account/session chrome, sidebar, character summaries, and current
   selection.
3. Replace the all-or-nothing initial resource fan-out with:
   - one coherent shell-resource read;
   - route-specific settings-group reads;
   - route-specific collection reads;
   - selected-character and selected-chat detail reads.
4. Reuse `fetchServerSettingsGroup()` and `fetchServerCollection()` rather than
   adding overlapping client APIs.
5. Add request deduplication, cancellation/supersession, revision validation, and
   per-resource retry.
6. Keep a shared revision barrier only for resource groups that must be applied
   atomically. Do not force unrelated route resources to converge before the
   shell renders.
7. Prefetch the most likely next resource only when it does not compete with
   selected-chat hydration or block readiness.

### Suggested ownership manifest

| Surface | Initial resource set |
| --- | --- |
| App shell/sidebar | display, language, sidebar, account, character summaries |
| Chat route | selected character, selected chat, prompt owner, runtime/model settings, plugins |
| Provider/model settings | providers, models, runtime |
| Appearance settings | display, language, media |
| Memory/lore tools | memory plus selected lore/detail resources |
| Module/plugin settings | modules, plugins, plugin custom storage |
| Preset editors | only the selected preset collection |

The manifest is a starting point and must be validated against actual component
reads before implementation.

### Verification

- Static or test-time assertions map resource consumers to a declared manifest.
- Browser tests deep-link into every route with an empty cache.
- Changing route during hydration cannot apply stale data to the new route.
- Revision-gap tests cover independently loaded groups.
- Network assertions prove unopened settings collections are absent from initial
  startup.

### Exit criteria

- Opening the chat route does not download unrelated settings and preset
  collections.
- Deep links load their required resources without depending on a previous route.
- A failure in one optional resource does not invalidate unrelated ready
  capabilities.

## WS6 — Pre-Writer Observer Shell

### Objective

Exploit the server-authoritative architecture by showing authenticated read-only
state while writer ownership and pending mutation recovery continue.

This is a separate rollout, not part of the first startup-phase release.

### Preconditions

- WS3 capability gates have shipped and direct-command tests demonstrate that
  user writes cannot bypass them.
- WS2 summaries and WS5 shell resources are small enough to justify an early
  read.
- The UI has a consistent, accessible read-only interaction treatment.
- Event/revision tests cover the observer-to-writer transition.

### Implementation

1. Fetch and authenticate the shell projection before writer acquisition.
2. Apply it behind the resource write guard and expose `observer-ready`.
3. Allow read-only navigation that does not persist selection. Queue the desired
   route/selection as local intent when persistence would otherwise be required.
4. Complete writer takeover and pending replay in the background.
5. Perform an authoritative post-replay refresh at the new revision.
6. Promote to `writer-ready` only after the refreshed projection is applied.
7. Reconcile observer-era route intent once writes are safe, avoiding redundant
   writes when the server already matches the intent.
8. If writer takeover fails, retain the observer shell with an explicit read-only
   status and retry action.

### Verification

- Simulate another active writer, expired ownership, takeover delay, and takeover
  denial.
- Inject server events and pending local mutations during observer mode.
- Prove that no stale pre-replay projection survives promotion to writer mode.
- Prove that observer navigation cannot enqueue a server mutation.
- Accessibility tests cover disabled controls, status announcement, and keyboard
  behavior.

### Exit criteria

- Authenticated read-only content appears before writer recovery on slow takeover
  scenarios.
- Promotion to writer mode is revision-safe and does not duplicate route or
  selection mutations.
- A permanently unavailable writer leaves a useful, clearly identified observer
  experience.

## WS7 — Hardening, Documentation, and Rollout

### Objective

Ship the startup changes with regression coverage, operational visibility, and a
safe rollback path.

### Implementation

- Keep the observer-shell behavior behind a temporary rollout flag until large
  database and multi-tab tests pass in real environments.
- Emit phase duration and failure-reason telemetry without including character,
  chat, prompt, or account content.
- Update `STRUCTURE.md` and the focused server-resource/bridge documentation with
  capability semantics and the character-summary contract.
- Document how developers capture a startup trace and interpret bundle budgets.
- Remove temporary compatibility aliases and flags after the rollout window.

### Verification matrix

Run focused tests during each workstream, then use the repository-wide commands at
the milestones below:

| Milestone | Required verification |
| --- | --- |
| Each review slice | relevant unit/DOM/server tests and `pnpm test:affected` |
| Bundle or startup boundary change | production build plus bundle report |
| Character projection complete | client/server contract tests and large-fixture size test |
| Capability coordinator complete | `pnpm build:smoke` and targeted browser smoke |
| Observer shell enabled | `pnpm smoke:fastify-browser` with multi-tab/takeover cases |
| Final integration | `pnpm test:all` |

Formatting and generated artifacts should follow the normal repository commands;
do not commit local trace data or temporary build directories.

### Rollback strategy

- Bundle slices are independently revertible.
- The summary endpoint can temporarily coexist with the existing aggregate until
  the client migration is complete.
- The compatibility `loadedStore` remains during WS3 migration.
- The observer shell has its own rollout flag; disabling it returns to the
  conservative post-replay shell boundary without undoing other improvements.

### Exit criteria

- Cold and warm startup results meet the ratified budgets on small and large
  fixtures.
- Multi-tab writer takeover, offline recovery, pending outbox replay, and event
  gap recovery pass end-to-end tests.
- Architecture documentation describes the shipped behavior rather than the
  transitional implementation.

## Primary Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| A lazy import remains eager through another path | Fail or flag static-plus-dynamic import warnings; inspect the generated preload graph |
| Theme/language flash after early mount | Keep the minimal display/language shell settings in the first coherent projection |
| Route application writes before recovery | Separate route parsing from application and enforce command-layer capability checks |
| Character shell is mistaken for full detail | Use the existing marker/type guard and reject detail-only operations until hydration |
| Event arrives between early read and subscription | Subscribe from the applied revision and test gap recovery at every transition |
| Plugin runtime moves late and changes chat output | Gate plugin-dependent chat/generation on `pluginsReady`; preserve accepted projections |
| Optional task failure poisons global startup | Track failures per capability and provide targeted retry |
| Observer data remains stale after outbox replay | Require an authoritative post-replay refresh before `writer-ready` |
| Manual chunks become a maintenance trap | Clean import boundaries first; keep manual groups few and behavior-oriented |

## Definition of Done

The overall initiative is complete when:

- the first useful shell no longer waits for chat bodies, plugins, push, inlays,
  model discovery, or unrelated settings collections;
- the initial character payload contains summaries rather than full character
  histories;
- the initial JavaScript graph meets its enforced budget;
- every write and generation path is protected by a capability check below the
  UI layer;
- the observer-to-writer transition is revision-safe under pending mutations,
  multi-tab ownership changes, and event gaps;
- focused, smoke, and full test suites pass; and
- startup measurements and architecture are documented for future contributors.
