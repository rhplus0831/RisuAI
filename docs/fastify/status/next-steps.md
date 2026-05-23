# Next Steps

Date: 2026-05-24

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

## Last Done

7-12d-iii-a added provider-agnostic `/chat` chunk transport. The new
`emitProviderChunks` helper maps existing `CompletionStreamFrame` sources
to the locked chat SSE `token`, `error`, and `done` events, and
`/api/v1/generate/chat` now has an internal `dispatchProvider` route hook
used only by server tests. The public request body did not change.

The route tests prove provider output begins only after the existing
`prompt` -> `message_patch` -> `stage(prompt,end)` -> `info` sequence.
Provider dispatch still runs in the browser in production because the
real send-path orchestration has not been wired yet.

## Immediate Pickup

Start with 7-12d-iii-b: wire send-path orchestration around server
dispatch.

Why this is next: 7-12d-iii-a proved the server stream can carry provider
`token`, terminal `error`, and terminal `done` events without disturbing
the prompt / mutation / telemetry ordering. The next slice should connect
that transport to the real server provider dispatch path and browser
send orchestration.

Expected scope:

- Resolve the server dispatch request from the assembled prompt payload and
  existing Phase 6 provider adapters.
- Wire browser send-like calls behind `db.useServerPromptAssembly` to
  consume `/chat` provider `token` / `done` / `error` events instead of
  continuing into local `dispatchRequest`.
- Add `generationId`, `generationInfo`, the `addRerolls` accumulator, and
  the enriched terminal `done` payload needed by the browser closeout path.
- Add end-to-end fixture coverage for the server-dispatch send path.

Out of scope for 7-12d-iii-b:

- `tts` side effects and restoration rollback.
- Hypa V3, plugin / Lua hooks, image generation, NovelAI string
  flattening, and low-level trigger effects.

## Queue After 7-12d-iii-b

1. 7-12d-iv: add `tts` `side_effect` and `error.restoration` rollback.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful, but not blocking
  7-12d.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run the relevant focused tests while implementing, then before closing a
slice run:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 7-12d-iii-a: `pnpm check` clean,
`pnpm api:test` 893 tests, `pnpm test` 622 tests plus 4 skipped, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and bundle-size warnings.

## References

- Active phase: [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Phase 7 archive through 7-12c:
  [`../phases-completed/phase-7-prompt-assembly-through-7-12c.md`](../phases-completed/phase-7-prompt-assembly-through-7-12c.md)
- 7-12d-i closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-i.md`](../phases-completed/phase-7-prompt-assembly-7-12d-i.md)
- 7-12d-ii closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-ii.md`](../phases-completed/phase-7-prompt-assembly-7-12d-ii.md)
- 7-12d-iii-a closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-iii-a.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iii-a.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
