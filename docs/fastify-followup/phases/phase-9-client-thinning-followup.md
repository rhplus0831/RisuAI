# Phase 9 Follow-Up - Client Thinning

Date: 2026-05-26

Status: reopened by audit.

## Goal

Make Fastify-served web a true server projection: durable writes go
through commands or import routes, direct projection writes fail, and
import/export events match the command map.

## Audit Findings

- Projection guard and `.risu` import/export event follow-ups are
  complete (`79b77f18`, `3fdb16d6`).
- Direct-write follow-up slices 9A-9G are complete through
  `7acf0cee`; commit anchors live in `../status.md`, and detailed
  landed notes belong under `../phases-completed/`.
- Remaining Phase 9 risk is the reachable durable `DBState.db` write
  surface not yet classified by 9H, 9I, and the final 9J sweep.

## Tasks

- Continue keeping expected projection refresh, optimistic command
  replay, or rollback behind `withTrustedServerProjectionWrite`.
- Sweep remaining direct `DBState.db` writes reachable in Fastify web
  mode. Route durable settings, character, chat, memory-toggle, and
  playground writes through commands or explicitly disable them when they
  are unsupported.
- Continue with 9H character lore/script/prompt/TTS/chat-name editors
  and 9I sidebar/loadout/welcome/runtime API classification before the
  final broad grep:
  `rg "bind:(value|check|list)=\\{DBState\\.db" src/lib src/ts`.
- Add command allowlist coverage for any remaining durable write found
  by the broader direct-write audit.

## Session Slices

Before each slice, refresh line numbers with the focused grep. Not every
`DBState.db` write is a bug: command replay, projection refresh,
rollback, import, and local-only workflows can keep trusted writes when
they are intentionally outside durable Fastify-web client mutation.

| Slice | State    | Scope                                                                                                 |
| ----- | -------- | ----------------------------------------------------------------------------------------------------- |
| 9A    | Complete | Provider routing and model scalar settings.                                                           |
| 9B    | Complete | OpenRouter, auxiliary model, separate-parameter, and EasyPanel selectors.                             |
| 9C    | Complete | Image provider settings.                                                                              |
| 9D    | Complete | Memory and audio provider settings.                                                                   |
| 9E    | Complete | Persona, display/theme, global regex, lore preset, and bot preset editors.                            |
| 9F    | Complete | Plugin, custom model, and advanced setting editors.                                                   |
| 9G    | Complete | Character core profile, media, and basic option editors.                                              |
| 9H    | Next     | Character lore, script, prompt, TTS, and chat-name editors.                                           |
| 9I    | Open     | Sidebar toggles, custom sidebar/loadout helpers, welcome setup, and runtime API write classification. |
| 9J    | Open     | Final direct-write sweep, allowlist gaps, browser smoke, and closeout.                                |

## Exit Criteria

- Fastify-served browser startup enables the projection guard. (Met by
  the 2026-05-26 guard slice.)
- A direct write to `DBState.db` in Fastify web mode fails unless it is
  wrapped in the trusted projection helper. (Met by the 2026-05-26 guard
  slice and browser smoke.)
- No reachable durable Fastify web workflow persists by direct client
  mutation.
- `.risu` import/export event behavior matches the command map. (Met by
  the 2026-05-26 event slice.)
- `pnpm smoke:fastify-browser` covers import and guard enforcement. (Met
  by the 2026-05-26 event slice.)

## Verification

```bash
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts
pnpm exec vitest run src/ts/moduleCommands.test.ts src/ts/server/commands.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm smoke:fastify-browser
pnpm check
```

## References

- Original phase: `docs/fastify/phases/phase-9-client-thinning.md`
- Original command map:
  `docs/fastify/status/phase-9-command-map.md:186`
- projection guard default: `src/ts/server/projectionWriteGuard.svelte.ts:5`
- settings draft helper:
  `src/ts/server/settingsBridge.svelte.ts:39`
- character draft helper:
  `src/ts/server/characterBridge.svelte.ts:37`
- save route registration: `server/fastify/src/routes/save.ts:41`
- current state event catalog: `server/fastify/src/commands/events.ts:301`
