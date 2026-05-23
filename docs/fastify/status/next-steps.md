# Next Steps

Date: 2026-05-24

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

## Last Done

7-12d-i landed the server-side mutation contract on `AssembleResult` and
persisted `varChanged` for send-like `/api/v1/generate/chat` requests.
The payload now captures user-message appends, run-var / start-trigger
message replacements, chat variable deltas, and `additonalSysPrompt`
prompt-row inserts. Preview and preview-prompt remain read-only from the
browser side.

## Immediate Pickup

Start with 7-12d-ii: serialize the mutation contract as `message_patch`
and add the browser applier.

Why this is next: 7-12d-i made the server mutations explicit, but the
`/chat` SSE stream still emits only `prompt` / `info` / `done`. The
browser cannot switch the send path to server assembly until those
mutations are delivered and applied to `currentChat.message`.

Expected scope:

- Emit a `message_patch` event from `/api/v1/generate/chat` after the
  `prompt` event for the 7-12d-i `result.mutations` payload.
- Replace `MessagePatchEvent.patch: unknown` with the typed payload shape
  on both server and browser mirrors.
- Teach `requestServerChat` to collect `message_patch` events instead of
  ignoring them.
- Add a narrow SPA applier that handles append and replace-all message
  mutations, plus the chat-variable deltas needed for `scriptstate`.
- Wire only enough of `sendChat` to consume server prompt assembly and
  apply patches before continuing to local `dispatchRequest`.

Out of scope for 7-12d-ii:

- Provider dispatch from `/chat`.
- `tts` side effects and restoration rollback.
- Hypa V3, plugin / Lua hooks, image generation, NovelAI string
  flattening, and low-level trigger effects.

## Queue After 7-12d-ii

1. 7-12d-iii-a: add provider-agnostic server chunk transport with
   server-only tests.
2. 7-12d-iii-b: wire send-path orchestration, `generationId`,
   `addRerolls`, enriched `done`, and end-to-end fixture coverage.
3. 7-12d-iv: add `tts` `side_effect` and `error.restoration` rollback.

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

Last recorded full baselines after 7-12d-i: `pnpm check` clean,
`pnpm api:test` 886 tests, `pnpm test` 618 tests plus 4 skipped, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and bundle-size warnings.

## References

- Active phase: [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Phase 7 archive through 7-12c:
  [`../phases-completed/phase-7-prompt-assembly-through-7-12c.md`](../phases-completed/phase-7-prompt-assembly-through-7-12c.md)
- 7-12d-i closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-i.md`](../phases-completed/phase-7-prompt-assembly-7-12d-i.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
