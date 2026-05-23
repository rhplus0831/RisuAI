# Next Steps

Date: 2026-05-24

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

## Last Done

7-12c (`8cf7fd63`) routed the `sendChat` preview and preview-prompt paths
through `/api/v1/generate/chat` behind `db.useServerPromptAssembly`.
Preview now consumes the server-assembled prompt payload, including the
full `OpenAIChat[]` `formated` rows and `biases`. Send / continue /
regenerate still use the local assembler.

## Immediate Pickup

Start with 7-12d-i: server-to-browser mutation handoff and `varChanged`
persistence.

Why this is next: the local send path mutates `currentChat` before and
after provider dispatch. The server `/chat` route currently returns an
assembled prompt, but it does not yet expose those chat-row and variable
deltas. The send path cannot safely switch to server assembly until those
mutations are explicit.

Expected scope:

- Extend `AssembleResult` with a typed mutation payload.
- Capture start-trigger chat edits.
- Capture `setvar` / `chatVars` deltas and persist `varChanged` through
  the route.
- Capture `additonalSysPrompt` rows and the user-message row push.
- Keep browser application read-only in this slice; the SPA applier is
  7-12d-ii.

Out of scope for 7-12d-i:

- `message_patch` SSE serialization and browser application.
- Provider dispatch from `/chat`.
- `tts` side effects and restoration rollback.
- Hypa V3, plugin / Lua hooks, image generation, NovelAI string
  flattening, and low-level trigger effects.

## Queue After 7-12d-i

1. 7-12d-ii: emit `message_patch` and add the browser applier while
   provider dispatch still runs locally.
2. 7-12d-iii-a: add provider-agnostic server chunk transport with
   server-only tests.
3. 7-12d-iii-b: wire send-path orchestration, `generationId`,
   `addRerolls`, enriched `done`, and end-to-end fixture coverage.
4. 7-12d-iv: add `tts` `side_effect` and `error.restoration` rollback.

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

Last recorded full baselines after 7-12c: `pnpm api:test` 882 tests,
`pnpm test` 618 tests plus 4 skipped, `pnpm check` clean, and
`pnpm build` passing with existing CSS / bundle-size warnings.

## References

- Active phase: [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Phase 7 archive through 7-12c:
  [`../phases-completed/phase-7-prompt-assembly-through-7-12c.md`](../phases-completed/phase-7-prompt-assembly-through-7-12c.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
