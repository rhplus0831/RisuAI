# Audit scope: Generation pipeline & model configuration

Status: DRAFT 2026-07-23 — items tagged `UNVERIFIED` are being re-checked by
the point-check verification pass.

## Charter

**In scope:** server prompt assembly (templates, CBS, triggers, Lua, token
budgeting), the generation request/stream/persist pipeline (inline and
durable jobs), reroll/swipe/continue/regenerate correctness, prompt
templates, bot/agent presets, model config profiles, and provider adapters.

**Out of scope:** translation of generated output (see
[translation.md](translation.md)); SSE transport generalities (see
[sync-hydration.md](sync-hydration.md)).

Key code: `server/fastify/src/prompt/`, `server/fastify/src/routes/generationChat.ts`,
`server/fastify/src/generation/` (provider adapters), `src/ts/process/`.

## Issue history

- **Cross-chat contamination class:** reroll buffers adopting a newly opened
  chat (round-4 high; reroll passed no `expectedTarget`), request inspector
  bound to the wrong message, branch targeting the post-confirm active chat
  (`71a0aaa82`). All fixed; the class is "generation state stamped from live
  selection instead of a latched target."
- **Template/preset destruction class:** prompt settings editor showed `[]`
  for fallback-state presets and deleted the compat mirror (round-4 high);
  queued preset creates/steps losing metadata (`810ab29a1`, `1ecf5d25c`).
- **Server-vs-browser parity class:** the null-coercion bug below; server
  budgeting text-only vs provider tokenizers (partially addressed by
  `e2eec9f72` portable tokenizer families).

## Open items

- `FIXED` 2026-07-23 — **server promptTemplate null coercion**: import,
  default, and preset normalization now preserve `null`, matching browser
  semantics where `null` uses format order and `[]` remains an active empty
  template.
- `ACCEPTED` (triggers listed in `leftover.md`) — inline generation
  persistence failure is best-effort (no `done.postGeneration` frame, no
  retry contract; durable jobs have the retry queue, inline sends don't).
- `ACCEPTED` — output-trigger transcript surgery is projection-only (message
  mutations from `output` triggers are browser patches, not durable
  transcript edits; don't survive reload/import).
- `ACCEPTED` — regenerate trimming depends on `Message.saying` heuristic;
  streaming-cancel terminal frame doesn't reconcile to the persisted row;
  `outputTokens` may be a response budget, not a measured count.
- `ACCEPTED` (Milestone-2 trigger) — in-flight generation jobs don't survive
  server restart (process-memory registry).
- `ACCEPTED` (symptom-gated) — server Lua host functions still stubbed:
  `LLM()`/`axLLM()`/`simpleLLM()`, `similarity()`, `generateImage()`, image
  getters, persona description, lorebook reads. Interactive-Lua classifier is
  a conservative source scan (can false-positive on comments).
- `ACCEPTED` (parity backlog, `deferred-features.md`) — provider adapter
  gaps: request-shape parity (tools, multimodal parts, thinking config,
  response schema), buffered-only streaming for several providers, no
  logit-bias rows, hosted model tools not sent.
- `EVIDENCE-GATED` — prompt-construction runtime narrowing (stage metrics
  exist; a slice needs one dominant stage named on a real corpus).

## Verified safe — do not re-audit

Ordinary delete/branch/copy/regenerate flows (2026-07-21 audit). Generation
request bodies send ids + new message only; tokens stream as deltas
(transfer-size audit "already tight" list).

## Invariants for new code

- Per-step/per-call model selection uses `profileIdOverride` in
  `requestDataArgument` — arg-level `fallbackProfileId` does NOT survive
  `requestChatData`'s fallback loop.
- wasmoon: ALL engine boots serialize behind `luaEngineBootGate` and start
  only while `activeLuaRuns === 0`; per-call `functionTimeout` is frozen at
  `createEngine`; external aborts land at yield boundaries only.
- Lua host functions doing server-side HTTP keep the SSRF guard, pinned DNS,
  response caps, shared egress window; hosted/multi-tenant deployment needs
  an owner decision first.
- Latch generation targets at interaction time (`expectedTarget`), never from
  live selection after an await.

## Sources

Memory: `server-prompttemplate-null-coercion-gotcha`,
`scripting-server-support-policy`, `stability-perf-audits-v1-v4-closed`
(wasmoon), `translator-preset-server-import-and-profile-override`
(profileIdOverride). Archive: `.archived-docs/generation-and-models/`,
`.archived-docs/deferred-work/leftover.md` (generation + Lua sections),
`.archived-docs/deferred-work/deferred-features.md` (provider parity tables).
