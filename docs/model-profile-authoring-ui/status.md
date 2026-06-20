# Model Profile Authoring UI Status

Date: 2026-06-20

This workstream is open and not yet implemented. It is a planning follow-up to
`.archived-docs/model-config-profiles/`, which completed durable profile
runtime support but deferred the full visible authoring UI.

## Snapshot

- Plan state: open.
- Current phase: Phase 0 not started.
- Current implementation state:
  - `Database.modelProfiles` and `Database.modelRoleProfiles` exist.
  - Visible role settings show resolved summaries, but still edit legacy flat
    fields.
  - Durable records lack provider-first `providerId`, raw model fallback rows,
    first-class Custom API/Vertex provider shapes, and `modelRuntimeDefaults`.
  - Profile-bound resolution can still fall back to legacy when durable
    selection fails.
  - Profile row commands and conversion commands do not exist.
  - `BotSettings.svelte` still owns the model settings surface, parameter
    submenu, and global provider panels.
- Current verification state: no new tests have been run for this workstream.

## Phase Router

| Phase | Status | Purpose |
| --- | --- | --- |
| Phase 0: Contract And Schema | Not started | Expand profile record/runtime-default schema, defaulting, storage, and secret masking. |
| Phase 1: Resolver Runtime Status | Not started | Add provider-first resolution, runtime default precedence, explicit broken-binding behavior, and status helpers. |
| Phase 2: Profile Commands And Conversion | Not started | Add atomic profile row commands, role binding operations, and legacy-to-profile conversion. |
| Phase 3: Settings Model Shell | Not started | Build Settings -> Model Roles/Profiles tabs, conversion prompt, and legacy compatibility panel. |
| Phase 4: Profile Editor Providers | Not started | Implement full profile editor panels for OpenAI, Anthropic, Google, Vertex, and Custom API plus defaults/fallbacks. |
| Phase 5: Generation Guardrails | Not started | Block incomplete/unsupported active profiles in browser and server generation paths. |
| Phase 6: Verification And Cleanup | Not started | Run regression, browser smoke, docs updates, and compatibility cleanup notes. |

## Current Blockers

- No implementation blockers yet.
- Open questions are tracked in [`plan.md`](plan.md#remaining-open-questions).

## Latest Decisions Captured

- The decision log lives at
  [`../model-profile-ui-ux-decisions.md`](../model-profile-ui-ux-decisions.md).
- This plan assumes those decisions are locked unless a future status update
  records a deliberate change.

