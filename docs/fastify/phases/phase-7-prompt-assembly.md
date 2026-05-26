# Phase 7 - Server-Side Prompt Assembly

Date: 2026-05-24

Status: closed 2026-05-24.

Post-closeout audit work for regenerate semantics, deferred-provider
guards, stop-trigger mutation delivery, and route-backed fixture coverage
closed in follow-up slices 7A-7E and is archived in
[`phase-7-prompt-assembly-followup.md`](phase-7-prompt-assembly-followup.md).

Closeout archive:
[`../phases-completed/phase-7-prompt-assembly-closeout.md`](../phases-completed/phase-7-prompt-assembly-closeout.md).

Final implementation slice: 7-12d-iv added typed `/chat` TTS side
effects and dispatch-error restoration rollback behind
`db.useServerPromptAssembly`.

Historical detail through 7-12c:
[`../phases-completed/phase-7-prompt-assembly-through-7-12c.md`](../phases-completed/phase-7-prompt-assembly-through-7-12c.md).
7-12d-i closeout:
[`../phases-completed/phase-7-prompt-assembly-7-12d-i.md`](../phases-completed/phase-7-prompt-assembly-7-12d-i.md).
7-12d-ii closeout:
[`../phases-completed/phase-7-prompt-assembly-7-12d-ii.md`](../phases-completed/phase-7-prompt-assembly-7-12d-ii.md).
7-12d-iii-a closeout:
[`../phases-completed/phase-7-prompt-assembly-7-12d-iii-a.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iii-a.md).
7-12d-iii-b closeout:
[`../phases-completed/phase-7-prompt-assembly-7-12d-iii-b.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iii-b.md).
7-12d-iv closeout:
[`../phases-completed/phase-7-prompt-assembly-7-12d-iv.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iv.md).

## Goal

Move prompt assembly from the browser into Fastify so the server can
assemble the prompt, report prompt metadata, and then drive generation
without requiring the browser to own mutable send-time state.

## Preconditions

- Phases 1-6 are closed.
- The final guardrails are the local `sendChat` fixture sweep, the
  server-backed provider sweep, and the Fastify generation route tests.

## Closeout Summary

Phase 7 closeout confirmed the original `/chat` assembly and dispatch
baseline behind `db.useServerPromptAssembly`. A later audit reopened
regenerate, provider-guard, stop-trigger, and route-backed fixture gaps;
those follow-up gaps closed again on 2026-05-27.

## Optional Or Parallel Work

- Build the normalized-DB parity artifact for cross-assembler tests. This
  did not block Phase 7 closeout.
- Add script-cache and `runTrigger('display', ...)` support only if
  `editdisplay` work needs it in a later phase.
- Add the input hook adapter only if Stage 1 becomes server-owned before
  Phase 9; otherwise defer it.
- Revisit hub-route session auth for browser-loaded hub resources.

## Boundaries

- Hypa V3 memory belongs to Phase 8, which is closed; remaining
  client-state ownership work belongs to Phase 9.
- Browser plugin / Lua execution, low-level LLM or image effects, and
  persistent character / persona / lorebook mutations stay out of Phase 7.
- Ooba OAI-compatible, NovelAI text, and NovelList remain deferred until
  server-side string flattening is available.
- Tauri-specific changes stay out of this migration phase unless a phase
  boundary explicitly calls for manual verification.

## Exit Criteria

- Closed: `send`, `continue`, `regenerate`, preview, and preview-prompt
  can use the server prompt assembly path behind
  `db.useServerPromptAssembly`.
- Closed: browser-visible chat mutations for successful assembly and
  stop-trigger aborts are represented as typed server events.
- Closed: server-side dispatch streams through the locked SSE taxonomy.
- Closed: the local `sendChat` fixtures, server-backed sweep, Fastify API
  tests, type check, and build pass.

## Verification

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

## References

- Live handoff: [`../status/next-steps.md`](../status/next-steps.md)
- Server status: [`../status/server.md`](../status/server.md)
- sendChat status: [`../status/sendchat.md`](../status/sendchat.md)
- Provider matrix: [`../coverage/providers.md`](../coverage/providers.md)
