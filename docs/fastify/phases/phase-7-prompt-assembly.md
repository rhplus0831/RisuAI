# Phase 7 - Server-Side Prompt Assembly

Date: 2026-05-24

Status: in progress.

Last completed slice: 7-12d-i added the typed server-side mutation
payload to `AssembleResult` and persisted `varChanged` for send-like
`/chat` requests. The send / continue / regenerate paths still run local
assembly until the 7-12d-ii browser applier lands.

Historical detail through 7-12c:
[`../phases-completed/phase-7-prompt-assembly-through-7-12c.md`](../phases-completed/phase-7-prompt-assembly-through-7-12c.md).
7-12d-i closeout:
[`../phases-completed/phase-7-prompt-assembly-7-12d-i.md`](../phases-completed/phase-7-prompt-assembly-7-12d-i.md).

## Goal

Move prompt assembly from the browser into Fastify so the server can
assemble the prompt, report prompt metadata, and then drive generation
without requiring the browser to own mutable send-time state.

## Preconditions

- Phases 1-6 are closed.
- The active guardrails are the local `sendChat` fixture sweep, the
  server-backed provider sweep, and the Fastify generation route tests.

## Remaining Work

### 7-12d-ii - `message_patch` event and browser applier

Serialize the 7-12d-i mutation contract as a `message_patch` SSE event and
add the SPA applier. The send path should still run local provider
dispatch in this slice: prompt from server, provider call from browser.
Re-run the local and server-backed `sendChat` fixtures.

### 7-12d-iii - server dispatch and streaming

Split by responsibility:

- 7-12d-iii-a: provider-agnostic server chunk transport with server-only
  tests.
- 7-12d-iii-b: send-path orchestration and browser wiring, including
  `generationId`, the `addRerolls` accumulator, enriched `done`, gate
  handling, and the end-to-end fixture sweep.

### 7-12d-iv - side effects and rollback

Add the `tts` `side_effect` event and `error.restoration` rollback path.
Keep image generation, Hypa V3, NovelAI string flattening, and plugin hooks
deferred.

## Optional Or Parallel Work

- Build the normalized-DB parity artifact for cross-assembler tests. This
  is not blocking 7-12d.
- Add script-cache and `runTrigger('display', ...)` support only if
  `editdisplay` work needs it before closeout.
- Add the input hook adapter only if Stage 1 becomes server-owned before
  Phase 9; otherwise defer it.
- Revisit hub-route session auth for browser-loaded hub resources.

## Boundaries

- Hypa V3 memory belongs to Phase 8.
- Browser plugin / Lua execution, low-level LLM or image effects, and
  persistent character / persona / lorebook mutations stay out of Phase 7.
- Ooba OAI-compatible, NovelAI text, and NovelList remain deferred until
  server-side string flattening is available.
- Tauri-specific changes stay out of this migration phase unless a phase
  boundary explicitly calls for manual verification.

## Exit Criteria

- `send`, `continue`, `regenerate`, preview, and preview-prompt can use the
  server prompt assembly path behind `db.useServerPromptAssembly`.
- Browser-visible chat mutations are represented as typed server events and
  applied without relying on hidden local assembly side effects.
- Server-side dispatch streams through the locked SSE taxonomy.
- The local `sendChat` fixtures, server-backed sweep, Fastify API tests,
  type check, and build pass.

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
