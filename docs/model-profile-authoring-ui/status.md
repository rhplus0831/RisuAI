# Model Profile Authoring UI Status

Date: 2026-06-20

This workstream is open and partially implemented. It is a planning follow-up
to `.archived-docs/model-config-profiles/`, which completed durable profile
runtime support but deferred the full visible authoring UI.

## Snapshot

- Plan state: open.
- Current phase: Phase 4 not started.
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
  - Old legacy role controls remain available behind Advanced Legacy Settings.
  - Full provider editor panels, runtime defaults editing, fallback editing, and
    generation guardrails are not implemented yet.
- Current verification state: Phase 0 through Phase 3 focused tests, TypeScript
  checks, and Phase 3 browser smoke passed.

## Phase Router

| Phase | Status | Purpose |
| --- | --- | --- |
| Phase 0: Contract And Schema | Completed | Expand profile record/runtime-default schema, defaulting, storage, and secret masking. |
| Phase 1: Resolver Runtime Status | Completed | Add provider-first resolution, runtime default precedence, explicit broken-binding behavior, and status helpers. |
| Phase 2: Profile Commands And Conversion | Completed | Add atomic profile row commands, role binding operations, and legacy-to-profile conversion. |
| Phase 3: Settings Model Shell | Completed | Build Settings -> Model Roles/Profiles tabs, conversion prompt, and legacy compatibility panel. |
| Phase 4: Profile Editor Providers | Not started | Implement full profile editor panels for OpenAI, Anthropic, Google, Vertex, and Custom API plus defaults/fallbacks. |
| Phase 5: Generation Guardrails | Not started | Block incomplete/unsupported active profiles in browser and server generation paths. |
| Phase 6: Verification And Cleanup | Not started | Run regression, browser smoke, docs updates, and compatibility cleanup notes. |

## Current Blockers

- No implementation blockers yet.
- Open questions are tracked in [`plan.md`](plan.md#remaining-open-questions).

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

## Latest Decisions Captured

- The decision log lives at
  [`../model-profile-ui-ux-decisions.md`](../model-profile-ui-ux-decisions.md).
- This plan assumes those decisions are locked unless a future status update
  records a deliberate change.
