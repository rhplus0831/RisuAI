# Next Steps

Date: 2026-05-24

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

## Last Done

7-12d-iv added the remaining server-dispatched `/chat` side-effect and
rollback boundary. The route now emits typed `side_effect` events for TTS
when `db.ttsAutoSpeech` is enabled, and provider dispatch failures after
browser-visible mutations include `error.restoration` with the chat
message/scriptstate snapshot needed to roll those mutations back.

The browser `/chat` generation adapter carries terminal side effects and
restoration payloads. `sendChat` applies server-sent TTS through the
existing `sayTTS` path, suppresses duplicate streaming TTS for
server-dispatched runs, restores chat state on terminal provider errors,
and preserves the existing error reporting path.

## Immediate Pickup

Start with a Phase 7 closeout check.

Why this is next: the last active 7-12d implementation slice is landed,
so the next agent should verify Phase 7 exit criteria and then open
Phase 8 Hypa V3 memory.

Expected scope:

- Confirm the Phase 7 exit criteria are met for send, continue,
  regenerate, preview, and preview-prompt behind
  `db.useServerPromptAssembly`.
- Refresh the full verification baseline.
- Move any remaining Phase 7 notes into the completed archive and keep
  the live status docs short.
- If clean, update the handoff so Phase 8 Hypa V3 memory is the default
  pickup.

Out of scope for the closeout check:

- Implementing Phase 8 memory routes, Phase 9 client thinning, image
  generation, NovelAI string flattening, or plugin / Lua hooks.

## Queue After Closeout

1. Phase 8 Hypa V3 memory pickup.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful, but not blocking
  the closeout check.
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

Last recorded full baselines after 7-12d-iv: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 895 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and bundle-size warnings.

Focused 7-12d-iv verification:

```bash
pnpm exec vitest run server/fastify/__tests__/generation.chat.test.ts --config server/fastify/vitest.config.ts
pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts src/ts/process/request/tests/serverMessagePatch.test.ts src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
```

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
- 7-12d-iv closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-iv.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iv.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
