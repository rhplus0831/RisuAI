# Next Steps

Date: 2026-05-24

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

## Last Done

7-12d-ii serialized the 7-12d-i mutation contract as a typed
`message_patch` SSE event, taught `requestServerChat` to collect patches,
and added a narrow browser applier for append / replace-all message
mutations plus chat `scriptstate` deltas.

Behind `db.useServerPromptAssembly`, preview and preview-prompt still use
server prompt assembly, and send-like calls can now consume the server
prompt payload, apply patches, and continue into local `dispatchRequest`.
Provider dispatch still runs in the browser. The server append path is
idempotent when the persisted chat already contains the browser-added last
user row.

## Immediate Pickup

Start with 7-12d-iii-a: add provider-agnostic server chunk transport with
server-only tests.

Why this is next: 7-12d-ii lets the browser consume server prompt assembly
without relying on hidden local assembly side effects, but `/chat` still
does not dispatch providers or stream token chunks. The next slice should
prove the chat SSE taxonomy can carry provider output before wiring the
browser orchestration around it.

Expected scope:

- Add a small provider-agnostic transport layer for `/chat` server dispatch
  chunks, mapping provider output into the locked `token`, `error`, and
  `done` chat SSE events.
- Keep this server-only: unit-test the transport with fake provider chunk
  sources and do not wire `sendChat` orchestration to server dispatch yet.
- Preserve the existing `prompt` -> `message_patch` -> `info` ordering from
  7-12d-ii before provider output begins.
- Do not add `generationId`, reroll accumulation, browser token handling,
  `tts`, or rollback yet; those belong to later 7-12d slices.

Out of scope for 7-12d-iii-a:

- Browser send-path orchestration for server dispatch.
- `generationId`, `addRerolls`, enriched terminal `done`, and gate
  handling.
- `tts` side effects and restoration rollback.
- Hypa V3, plugin / Lua hooks, image generation, NovelAI string
  flattening, and low-level trigger effects.

## Queue After 7-12d-iii-a

1. 7-12d-iii-b: wire send-path orchestration, `generationId`,
   `addRerolls`, enriched `done`, and end-to-end fixture coverage.
2. 7-12d-iv: add `tts` `side_effect` and `error.restoration` rollback.

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

Last recorded full baselines after 7-12d-ii: `pnpm check` clean,
`pnpm api:test` 887 tests, `pnpm test` 622 tests plus 4 skipped, and
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
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
