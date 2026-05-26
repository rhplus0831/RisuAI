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
- Highest-risk gap: Phase 9 still needs the remaining direct-write sweep
  after the completed settings/editor slices.
- Phase 9 follow-up has landed guard/import-event work plus slices 9A-9G;
  use the table below for commit anchors and `status/next-steps.md` for
  pickup order.
- Next default pickup: Phase 9 Slice 9I, sidebar toggles, custom
  sidebar/loadout helpers, welcome setup, and runtime API write
  classification.
- Closeout rule: keep this file to the current snapshot. Put landed
  slice detail under `phases-completed/`.

## Recent Phase 9 Anchors

| Commit                                            | Scope                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `79b77f18` / `3fdb16d6`                           | Projection guard plus `.risu` import/export events.                           |
| `cb6eb430` / `0cb57753` / `76d46a0a` / `bdcc40bd` | Module selection, Ooba, bot parameter, and prompt settings.                   |
| `92a5b83c`                                        | 9A provider routing and model scalar settings.                                |
| `997468f7`                                        | 9B OpenRouter, auxiliary model, separate-parameter, and EasyPanel selectors.  |
| `ef750089`                                        | 9C image provider settings.                                                   |
| `e655f27e`                                        | 9D memory and audio provider settings.                                        |
| `2321516b`                                        | 9E persona, display/theme, global regex, lore preset, and bot preset editors. |
| `668ea890`                                        | 9F plugin, custom model, and advanced setting editors.                        |
| `7acf0cee`                                        | 9G character core profile, media, and basic option editors.                   |
| pending                                           | 9H character lore, script, prompt, TTS, and chat-name editors.                |

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
