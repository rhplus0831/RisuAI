# Fastify Follow-Up Status

Date: 2026-05-27

This is the first audit follow-up snapshot after Phases 0-9 were
reported closed. The current live status is [`../status.md`](../status.md).

Policy note: there are no actual Fastify users yet, so do not add
compatibility migrations for intermediate Fastify shapes. Update the
current server schema, command surface, and import/export paths
directly.

## Current Snapshot

- Active work in this first follow-up: none. All identified first-audit
  slices are closed.
- Current handoff: none open. The second-pass alpha audit is closed in
  [`../status.md`](../status.md).
- No follow-up found in this audit: Phases 1, 2, 4, and 5.
- Next default pickup here: none. Start a new focused handoff only after
  a fresh audit finding is recorded.
- Closeout rule: keep this file to the current snapshot. Put landed
  slice detail under `phases-completed/`.

## Recent Follow-Up Anchors

| Phase | Commit(s)                          | Scope                                                        |
| ----- | ---------------------------------- | ------------------------------------------------------------ |
| 0     | `3f421660`                         | 0A removed the tracked Google Drive public worker artifact.  |
| 3     | `e92e2d7e`                         | 3A aligned stream-job proxy headers with direct proxy output. |
| 6     | `db64bf28` / `a16f9c8d` / `f7970af4` | 6A-6C closed streaming provider error-frame handling.        |
| 7     | `e49d21de` through `e7425ab1`      | 7A-7E closed regenerate, provider guard, stop-trigger, and route-backed fixture gaps. |
| 8     | `4ba2895e` / `eb797ded` / `e618766f` | 8A-8C closed custom embedding, progress event, and missing-summary gaps. |
| 9     | `79b77f18` through `67a9dab4`      | Guard/import-event work plus 9A-9J closed direct-write follow-up. |

## Recent Phase 9 Anchors

| Commit                                            | Scope                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `79b77f18` / `3fdb16d6`                           | Projection guard plus `.risu` import/export events.                                                |
| `cb6eb430` / `0cb57753` / `76d46a0a` / `bdcc40bd` | Module selection, Ooba, bot parameter, and prompt settings.                                        |
| `92a5b83c`                                        | 9A provider routing and model scalar settings.                                                     |
| `997468f7`                                        | 9B OpenRouter, auxiliary model, separate-parameter, and EasyPanel selectors.                       |
| `ef750089`                                        | 9C image provider settings.                                                                        |
| `e655f27e`                                        | 9D memory and audio provider settings.                                                             |
| `2321516b`                                        | 9E persona, display/theme, global regex, lore preset, and bot preset editors.                      |
| `668ea890`                                        | 9F plugin, custom model, and advanced setting editors.                                             |
| `7acf0cee`                                        | 9G character core profile, media, and basic option editors.                                        |
| `007dbe3c`                                        | 9H character lore, script, prompt, TTS, and chat-name editors.                                     |
| `c1966217`                                        | 9I sidebar toggles, custom sidebar/loadout helpers, welcome setup, and runtime API classification. |
| `67a9dab4`                                        | Final direct-write sweep, allowlist gaps, browser smoke, and Phase 9 closeout.                     |

## Phase Status

| Phase                                   | State        | Why Reopened                                                                                              | Task Doc                                                                                   |
| --------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0 - Removals                            | Closed       | 0A removed the tracked Google Drive OAuth worker from `public/` and verified the build.                   | [`../phases/phase-0-removals-followup.md`](../phases/phase-0-removals-followup.md)               |
| 1 - Foundation                          | No follow-up | Audit found Fastify foundation shape complete.                                                            | None                                                                                       |
| 2 - Storage / import / assets / backups | No follow-up | Audit found storage route baseline complete.                                                              | None                                                                                       |
| 3 - Proxy migration                     | Closed       | 3A shared direct proxy response-header filtering with stream-job `upstream_headers` events.               | [`../phases/phase-3-proxy-followup.md`](../phases/phase-3-proxy-followup.md)                     |
| 4 - sendChat tests                      | No follow-up | Audit found test scaffold complete for the migration slice.                                               | None                                                                                       |
| 5 - sendChat extraction                 | No follow-up | Audit found browser extraction baseline complete.                                                         | None                                                                                       |
| 6 - Server-side generation              | Closed       | 6C aligned Ollama NDJSON stream failures with typed error frames and completed the final stream audit.    | [`../phases/phase-6-generation-followup.md`](../phases/phase-6-generation-followup.md)           |
| 7 - Server-side prompt assembly         | Closed       | 7E added route-backed fixture coverage for send, continue, regenerate, preview, and preview-prompt paths. | [`../phases/phase-7-prompt-assembly-followup.md`](../phases/phase-7-prompt-assembly-followup.md) |
| 8 - Hypa V3 memory                      | Closed       | 8C added missing-summary diagnostics and follow-ups for chunks with no embedding yet.                     | [`../phases/phase-8-memory-followup.md`](../phases/phase-8-memory-followup.md)                   |
| 9 - Client thinning                     | Closed       | 9J removed the remaining focused direct-bind hits, covered allowlist gaps, and passed browser smoke.      | [`../phases/phase-9-client-thinning-followup.md`](../phases/phase-9-client-thinning-followup.md) |

## Closeout Expectations

- Each follow-up phase must include focused tests for the regression it
  fixes.
- Broad closeout should run `pnpm check`, `pnpm test`, `pnpm api:test`,
  and `pnpm build` unless a narrower change has an explicit owner
  approval to defer the full matrix.
- Fastify-served browser behavior passed `pnpm smoke:fastify-browser`
  for the Phase 9 follow-up closeout; rerun it before closing any future
  browser projection sweep.
