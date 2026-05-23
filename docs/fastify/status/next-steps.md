# Next Steps

Date: 2026-05-24

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

## Last Done

7-12d-iii-b wired production `/chat` provider dispatch and browser send
orchestration. The route now resolves a server dispatch request from the
assembled prompt and persisted database settings when
`db.useServerPromptAssembly` is enabled, emits `info.generationId` /
`info.generationInfo`, streams provider `token` events, and sends an
enriched terminal `done`.

Browser send-like calls behind `db.useServerPromptAssembly` now consume
the `/chat` token stream directly instead of continuing into local
`dispatchRequest`. The existing response orchestration still applies the
assistant row, output scripts, inlay screen, auto-continue, IGP, Stage 4,
and `addRerolls`; server-dispatch fixture coverage proves these calls do
not escape to `/api/v1/generate/completion`.

## Immediate Pickup

Start with 7-12d-iv: add `tts` `side_effect` and
`error.restoration` rollback.

Why this is next: the main server-dispatched send path is now wired, but
provider errors after partial token output still surface as terminal
errors without a restoration payload, and TTS remains a browser closeout
side effect instead of a typed server event.

Expected scope:

- Add a typed `side_effect` event for `tts` that matches the locked
  `/chat` SSE taxonomy.
- Add an `error.restoration` payload for server-dispatch failures after
  browser-visible mutations begin.
- Make the browser `/chat` generation adapter apply restoration on
  terminal errors without disturbing the existing error reporting path.
- Add route and sendChat fixture coverage for the rollback boundary.

Out of scope for 7-12d-iv:

- Hypa V3, plugin / Lua hooks, image generation, NovelAI string
  flattening, and low-level trigger effects.

## Queue After 7-12d-iv

1. Phase 7 closeout check, then Phase 8 Hypa V3 memory pickup.

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

Last recorded full baselines after 7-12d-iii-b: `pnpm check` clean,
`pnpm test` 635 tests plus 4 skipped, `pnpm api:test` 894 tests, and
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
- 7-12d-iii-b closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-iii-b.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iii-b.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
