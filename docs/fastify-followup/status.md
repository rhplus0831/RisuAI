# Fastify Follow-Up Status

Date: 2026-05-26

This is the live handoff for audit follow-up work after Phases 0-9 were
reported closed in `docs/fastify`.

Policy note: there are no actual Fastify users yet, so do not add
compatibility migrations for intermediate Fastify shapes. Update the
current server schema, command surface, and import/export paths
directly.

## Current Snapshot

- Active work: audit follow-up for Phases 0, 3, 6, 7, 8, and 9.
- No follow-up found in this audit: Phases 1, 2, 4, and 5.
- Highest-risk gap: Phase 9 still needs a broader direct-write audit
  beyond the named guard slice.
- The reopened work is now split into session-sized slices. Use
  `status/next-steps.md` for pickup order and the affected phase file
  for slice scope, boundaries, and exit criteria.
- Landed 2026-05-26: Phase 9 import/export event semantics now emit
  `state.imported` / `state.exported` in line with the command map, and
  Fastify browser smoke covers multipart `.risu` import.
- Landed 2026-05-26: Phase 9 module-selection writes now use
  command-backed trusted optimistic helpers for chat and character
  module toggles.
- Landed 2026-05-26: Phase 9 Bot/Ooba settings for `ooba`,
  `reverseProxyOobaArgs`, and `localStopStrings` now bind to local
  command-backed drafts instead of mutating the Fastify projection
  directly.
- Landed 2026-05-26: Phase 9 Bot parameter settings for `NAIsettings`,
  `ainconfig`, `bias`, and `additionalParams` now bind to command-backed
  drafts, with grouped provider-command allowlist coverage.
- Landed 2026-05-26: Phase 9 Prompt settings and prompt-template editor
  writes now use local command-backed drafts/trusted optimistic projection
  writes instead of binding directly to the Fastify projection.
- Landed 2026-05-26: Phase 9 provider routing and model scalar settings
  in `BotSettings.svelte` now use command-backed drafts for model
  selection, provider credentials, provider model fields, and related
  reset side effects.
- Landed 2026-05-26: Phase 9 OpenRouter settings, auxiliary model
  selectors, separate-parameter selectors, and EasyPanel shortcuts now
  bind to command-backed drafts for provider routing arrays, auxiliary
  models, separate parameter overrides, and EasyPanel setup toggles.
- Landed 2026-05-26: Phase 9 image provider settings in
  `OtherBotSettings.svelte` now use command-backed drafts for Stable
  Diffusion WebUI, NovelAI image, Dall-E, Stability, ComfyUI, Fal,
  Imagen, OpenAI-compatible image, and WaveSpeed settings.
- Landed 2026-05-26: Phase 9 memory and audio provider settings in
  `OtherBotSettings.svelte` and `PlaygroundEmbedding.svelte` now bind
  through command-backed drafts for TTS provider keys, emotion processor
  selection, Hypa V3 presets, embedding provider settings, custom
  embedding settings, and Voyage keys.
- Landed 2026-05-26: Phase 9 persona, display/theme, global regex, lore
  preset, and bot preset editors now route Fastify-web mutations through
  command-backed settings, persona, preset, or lorebook helpers.
- Landed 2026-05-26: Phase 9 plugin settings, custom models, and
  advanced setting editors now avoid raw Fastify projection mutation.
  Plugin argument/edit/install paths use trusted optimistic plugin
  commands, custom models and ban-character-set bind through
  command-backed drafts, and advanced command classification now covers
  `allowAllExtentionFiles` and `auxModelUnderModelSettings`.
- Landed 2026-05-26: Phase 9 character core profile, media, and basic
  option editors in `CharConfig.svelte` now bind through a local
  server-backed character draft or trusted media helpers instead of
  mutating the Fastify projection directly.
- Next default pickup: Phase 9 Slice 9H, character lore, script, prompt,
  TTS, and chat-name editors.
- Closeout rule: update this file and the affected phase file when each
  reopened phase closes. Keep long landed notes out of this directory.

## Phase Status

| Phase                                   | State        | Why Reopened                                                                                                            | Task Doc                                                                                   |
| --------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0 - Removals                            | Reopened     | Tracked Google Drive OAuth worker remains under `public/`.                                                              | [`phases/phase-0-removals-followup.md`](phases/phase-0-removals-followup.md)               |
| 1 - Foundation                          | No follow-up | Audit found Fastify foundation shape complete.                                                                          | None                                                                                       |
| 2 - Storage / import / assets / backups | No follow-up | Audit found storage route baseline complete.                                                                            | None                                                                                       |
| 3 - Proxy migration                     | Reopened     | Stream-job proxy response header filtering diverges from direct proxy filtering.                                        | [`phases/phase-3-proxy-followup.md`](phases/phase-3-proxy-followup.md)                     |
| 4 - sendChat tests                      | No follow-up | Audit found test scaffold complete for the migration slice.                                                             | None                                                                                       |
| 5 - sendChat extraction                 | No follow-up | Audit found browser extraction baseline complete.                                                                       | None                                                                                       |
| 6 - Server-side generation              | Reopened     | `/api/v1/generate/completion` streaming provider failures can be emitted as empty successful SSE streams.               | [`phases/phase-6-generation-followup.md`](phases/phase-6-generation-followup.md)           |
| 7 - Server-side prompt assembly         | Reopened     | Regenerate, deferred/local provider guards, stop-trigger mutations, and route-level fixture coverage remain incomplete. | [`phases/phase-7-prompt-assembly-followup.md`](phases/phase-7-prompt-assembly-followup.md) |
| 8 - Hypa V3 memory                      | Reopened     | Custom embedding model routing, memory progress events, and missing-summary follow-ups need fixes.                      | [`phases/phase-8-memory-followup.md`](phases/phase-8-memory-followup.md)                   |
| 9 - Client thinning                     | Reopened     | Remaining direct-write coverage does not yet meet the Phase 9 contract.                                                 | [`phases/phase-9-client-thinning-followup.md`](phases/phase-9-client-thinning-followup.md) |

## Closeout Expectations

- Each follow-up phase must include focused tests for the regression it
  fixes.
- Broad closeout should run `pnpm check`, `pnpm test`, `pnpm api:test`,
  and `pnpm build` unless a narrower change has an explicit owner
  approval to defer the full matrix.
- Fastify-served browser behavior should pass `pnpm smoke:fastify-browser`
  before Phase 9 is considered closed again.
