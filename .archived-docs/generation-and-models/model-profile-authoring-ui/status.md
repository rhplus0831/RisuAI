# Model Profile Authoring UI Status

Date: 2026-06-20

This workstream is closed. It was a planning follow-up to
`.archived-docs/generation-and-models/model-config-profiles/`, which completed durable profile
runtime support but deferred the full visible authoring UI. The deferred editor,
conversion workflow, commands, guardrails, docs, and final smoke are now
complete.

## Snapshot

- Plan state: complete.
- Current phase: closed after Phase 6.
- Current implementation state:
  - `Database.modelProfiles` and `Database.modelRoleProfiles` exist.
  - Durable records now include optional provider-first `providerId`, raw model
    fallback rows, first-class Custom API/Vertex provider shape support, and
    `modelRuntimeDefaults`.
  - Explicit broken durable profile bindings now surface incomplete status
    instead of silently falling back to legacy.
  - Profile-bound runtime resolution uses hard defaults, `modelRuntimeDefaults`,
    then profile overrides without borrowing legacy flat parameter fields.
  - Profile row commands, role binding commands, runtime defaults command, and
    legacy conversion command now exist.
  - Settings -> Model now routes to a profile-first shell with Roles and
    Profiles tabs, explicit role binding Apply/Cancel, profile list action
    shells, runtime defaults summary, and a legacy conversion prompt.
  - Profiles tab now has a full command-backed editor drawer for first-class
    OpenAI, Anthropic, Google, Vertex, and Custom API profiles, plus runtime
    defaults editing, profile runtime overrides, fallback editing, and secret
    preserve/replace/clear handling.
  - Custom API profile dispatch supports optional API keys for local
    unauthenticated OpenAI-compatible endpoints.
  - Old legacy role controls remain available behind Advanced Legacy Settings.
  - Generation now rejects active incomplete/unsupported durable profiles in
    browser preflight, browser request dispatch, server-intent completion,
    `/generate/chat` preflight, and final server chat dispatch.
  - Server chat prompt assembly now applies profile-bound model/runtime fields
    from the effective chat generation config before budgeting and dispatch.
  - Closeout structure/runtime docs now describe Settings -> Model as
    profile-first and record compatibility caveats.
- Current verification state: Phase 0 through Phase 6 focused tests,
  TypeScript checks, `git diff --check`, and final `/settings/model` browser
  smoke passed.

## Phase Router

| Phase | Status | Purpose |
| --- | --- | --- |
| Phase 0: Contract And Schema | Completed | Expand profile record/runtime-default schema, defaulting, storage, and secret masking. |
| Phase 1: Resolver Runtime Status | Completed | Add provider-first resolution, runtime default precedence, explicit broken-binding behavior, and status helpers. |
| Phase 2: Profile Commands And Conversion | Completed | Add atomic profile row commands, role binding operations, and legacy-to-profile conversion. |
| Phase 3: Settings Model Shell | Completed | Build Settings -> Model Roles/Profiles tabs, conversion prompt, and legacy compatibility panel. |
| Phase 4: Profile Editor Providers | Completed | Implement full profile editor panels for OpenAI, Anthropic, Google, Vertex, and Custom API plus defaults/fallbacks. |
| Phase 5: Generation Guardrails | Completed | Block incomplete/unsupported active profiles in browser and server generation paths. |
| Phase 6: Verification And Cleanup | Completed | Run regression, browser smoke, docs updates, and compatibility cleanup notes. |

## Current Blockers

- None. The historical open questions are closed in
  [`plan.md`](plan.md#closed-questions-and-outcomes).

## Latest Completed Slice

- Phase 0 added optional profile `providerId`, expanded provider option shapes,
  raw model fallback rows, `modelRuntimeDefaults`, preservation across
  settings/preset/loadout paths, and profile-local Vertex private key masking.
- Verification passed focused client/server Vitest suites, client-lib
  TypeScript, strict Fastify TypeScript, resolver regression coverage, and
  `git diff --check`.
- Phase 1 added resolved profile status buckets, profile-local first-class
  provider handling, broken-binding incomplete states, and profile-bound runtime
  default precedence.
- Verification passed resolver/UI-state/provider-capability suites, model role
  routing, server prompt/durable generation preflight checks, client-lib
  TypeScript, strict Fastify TypeScript, and `git diff --check`.
- Phase 2 added atomic model profile commands, runtime defaults updates, role
  binding updates, create-and-bind, delete reassignment, duplication secret
  controls, legacy-to-profile conversion, client wrappers, and `modelProfile`
  targeted projection.
- Verification passed client command wrapper tests, Fastify command/projection/
  provider-secret suites, route protection, client-lib TypeScript, strict
  Fastify TypeScript, and `git diff --check`.
- Phase 3 added the Settings -> Model profile-first shell, Roles/Profiles tabs,
  command-backed role binding drafts, profile list action shells, a legacy
  conversion prompt, and an Advanced Legacy Settings section.
- Verification passed focused UI/lang suites, command/UI-state suites,
  client-lib TypeScript, `git diff --check`, and browser smoke for
  `/settings/model`.
- Phase 4 added the full profile editor drawer, first-class provider panels,
  runtime defaults editor, profile runtime overrides, fallback editor, shared
  profile secret placeholder handling, and narrow Custom API optional-auth
  dispatch support.
- Verification passed focused UI/lang suites, client command wrapper suites,
  model profile resolver/record/UI-state suites, Fastify command/OpenAI/
  dispatch suites, client-lib and strict Fastify TypeScript, `git diff --check`,
  and desktop/mobile `/settings/model` browser smoke.
- Phase 5 added shared active durable-profile generation guardrails, browser
  preflight/request rejection, server-intent and `/generate/chat` rejection
  before provider dispatch/SSE/job acceptance, server chat dispatch
  defense-in-depth, and effective profile-bound runtime overlay for server chat
  assembly.
- Verification passed focused browser request/provider/preflight suites,
  Fastify generation chat/completion/dispatch suites, and TypeScript checks.
- Phase 6 refreshed structure/runtime/workstream docs, recorded canonical
  compatibility caveats, ran the full requested focused validation matrix, ran
  client-lib and strict Fastify TypeScript checks, ran `git diff --check`, and
  passed the required `/settings/model` browser smoke with `pnpm dev:agent`
  using a temp data dir. The dev server was stopped after smoke.

## Compatibility Caveats

- Legacy flat fields remain: `aiModel`, `subModel`, `modelRoles`,
  `seperateModels`, `fallbackModels`, separate parameters, and provider globals.
  They are compatibility/conversion data behind Advanced Legacy Settings or
  import/preset/loadout paths.
- Compatibility profiles omit `providerId`. They may generate when routable,
  but they are not first-class provider panels.
- Unsupported `providerId` values are placeholders. They are shown unsupported
  and blocked for active durable generation.
- Memory summaries use memory-role profiles. Memory embeddings remain separate
  Hypa/Voyage/custom embedding config.
- Custom Models catalog entries (`customModels` / `xcustom:::`) remain separate
  from first-class Custom API profiles.

## Latest Decisions Captured

- The decision log lives at
  [`decisions.md`](decisions.md).
- This plan assumes those decisions are locked unless a future status update
  records a deliberate change.
