# Model Config Profiles Status

Date: 2026-06-19

This workstream is proposed and open. No runtime behavior changes have landed
from this plan yet. The current task created the planning folder and initial
phase router after local code exploration and sub-agent review.

## Snapshot

- Plan state: open.
- Current phase: Phase 0, current contracts, not started.
- Current implementation state: existing flattened `Database` fields remain the
  source of truth. `ModelRoleList.svelte` edits model ids and some role-adjacent
  settings; `BotSettings.svelte` still owns global provider and model options.
- Current compatibility state: no profile data model exists yet.
- Current verification state: documentation-only change. See
  [`latest-verification.md`](latest-verification.md).

## Phase Router

| Phase | Status | Purpose |
| --- | --- | --- |
| Phase 0: Current Contracts | Not started | Freeze current role, provider, preset, fallback, masking, static model, and memory behavior. |
| Phase 1: Read-Only Profile Resolver | Not started | Add a shared resolver and compatibility adapter while storage stays flat. |
| Phase 2: Preset Composition | Not started | Centralize base DB, selected model preset, and selected prompt preset composition. |
| Phase 3: Generation Dispatch | Not started | Adopt resolved profiles in browser and Fastify generation paths. |
| Phase 4: UI & Command Adapter | Not started | Adapt role/profile UI and settings commands while writes target existing fields. |
| Phase 5: Custom, Secrets & Auxiliary | Not started | Harden custom models, masking, memory, translation, scripts, MCP, playground, fallbacks, and tools. |
| Phase 6: Persisted Profiles | Not started | Add durable profile records and role bindings after derived parity is proven. |
| Phase 7: Verification & Cleanup | Not started | Run final regression, browser smoke, docs updates, compatibility cleanup, and TypeScript proof. |

## Immediate Next Steps

1. Complete Phase 0 by freezing current behavior and adding the first parity
   fixtures before any runtime consumer switches.
2. Build the Phase 1 resolver as a read-only compatibility layer over existing
   settings, not as a persisted storage change.
3. Move preset composition and then dispatch to the resolver contract before
   changing the database shape.
4. Keep UI writes targeting existing fields until the profile editor behavior
   is proven.
5. Update `status.md` at the end of each phase with proof or explicit gaps.

## Known Open Decisions

- Whether durable profiles eventually store provider secrets inline, in a nested
  credentials block, or by reference to provider-account records.
- Whether `customModels` should stay a model catalog consumed by profiles or
  move into provider-specific profile records.
- Which legacy fields become profile-local first when Phase 6 introduces
  persisted records, especially OpenAI-compatible, OpenRouter, NanoGPT, Ollama,
  and Custom API options.
- Whether prompt preset model overrides should bind roles to alternate profiles,
  patch selected profile fields, or remain as explicit legacy overrides during
  compatibility.
- Whether memory embeddings eventually join the same profile model, since they
  currently use `hypaModel`, `hypaCustomSettings`, `hypaV3Key`, and
  `voyageApiKey`.
