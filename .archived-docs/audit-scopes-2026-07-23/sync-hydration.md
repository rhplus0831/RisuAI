# Audit scope: Client↔server sync & hydration

Status: DRAFT 2026-07-23 — items tagged `UNVERIFIED` are being re-checked by
the point-check verification pass.

## Charter

**In scope:** bootstrap and resource projection, lazy hydration (chat
messages, lorebooks, character shells), revision fencing and staleness
guards, SSE command/event streams and reconnect behavior, acknowledgement /
settlement semantics of dispatched commands, queued-mutation replay across
refresh/restore, and full-resync triggers.

**Out of scope:** outbox scoping/crypto (see
[writer-outbox.md](writer-outbox.md)); what generation streams carry (see
[generation-models.md](generation-models.md)).

Key code: `src/ts/bootstrap.ts`, `src/ts/server/` (hydration, projection
resync, assets), `server/fastify/src/routes/projection.ts`,
`server/fastify/src/routes/events.ts`, `server/fastify/src/routes/commands.ts`.

## Issue history

The largest *volume* of fixes in the project lives here — the July 17–18
"settle/fence/retain/replay" batch alone is ~20 commits (queued settings
across restore, prompt-item acknowledgement fencing by attempt, queued
translator/agent-preset replay, stalled resource stream recovery, character
pointers across settings acks, reroll buffer scoping, etc.).

Signature defects:

- **Hydration revision drop** (fixed 2026-06-03): a slow hydration response
  was dropped as stale because an unrelated fast command advanced the global
  revision mid-flight. Deterministic for large chats. The fix compares against
  a request-start baseline (`isOlderThanBaselineRevision`).
- **Resource-guard optimistic-write gap** (fixed 2026-05-27): optimistic
  local writes mutating the read-only projection without
  `withTrustedResourceWrite`, or via references captured before the wrap.
- **Round-4 pattern 3:** `'discarded'` replay settlements treated as
  convergence — lineage-mismatch outbox deletions published no settlement, so
  callers counted them as success.

**Recurring patterns here:** comparing a response to *live* global state
instead of a request-start baseline; acknowledgements fenced by resource
instead of by attempt; every full-resync trigger resetting UI state the user
was holding (the `untrack(applyRouteToStores)` class); silently-dead streams.

## Open items

- ~~No SSE liveness watchdog; 409s never trigger resync~~ — **FIXED in
  `5b0d2da81`** (verified 2026-07-23): a 60-second frame watchdog tears down
  and reconnects a silent stream (`src/ts/bootstrap.ts:179`, `:536`, against
  25-second server heartbeats, `server/fastify/src/routes/events.ts:176`),
  and command 409 handling compares against the tracked applied projection
  and triggers a full resource refresh + SSE restart
  (`src/ts/server/commands.ts:5527` → `src/ts/bootstrap.ts:610`). The
  long-standing decision item for this scope is resolved.
- `ACCEPTED` (deferred at client-thinning closeout) — **surgical SSE event
  patching**: command SSE events stay payload-free deltas and the client
  re-fetches by resource/id. Revisit only with transfer-size evidence.
- `VERIFIED-OPEN` (2026-07-23) — **`enableLorebookStubs`** remains an
  experimental opt-in, OFF by default (`=== true` checks at
  `server/fastify/src/repository.ts:1380`, `:1518`; experimental warning at
  `src/ts/setting/advancedSettingsData.ts:206`), pending maintainer real-app
  validation of the client globalLore reader surface. A decision item, not a
  defect.
- `EVIDENCE-GATED` — sprawling-resource (`settings`/`state`/`pluginStorage`)
  full-bootstrap fallback narrowing; metrics exist
  (`projection_response` mode/fallbackClass). Not an audit target.

## Verified safe — do not re-audit

Receipt-ACK sequencing, specialized hydration baselines, scoped-loader
whole-DB write-back invariant (2026-07-21 audit). Command SSE events being
payload-free deltas was measured "already tight" by the transfer-size audit.

## Invariants for new code

- **Never compare a hydration response's revision to the live cached
  revision** — the global counter advances on ANY command; capture a
  request-start baseline.
- Optimistic writes wrap in `withTrustedResourceWrite` and re-read
  `getDatabase()`/`DBState.db` **inside** the wrap.
- Full resync (revision gap, no baseline, projection error, restore, import)
  reassigns `DBState.db` and re-fires route effects — new route-coupled state
  must survive that (the `botMakerMode` lesson).
- New scalar settings keys: `undefined` on existing DBs; read sites need
  `?? default` and a `getValue` fallback.
- Per-chat sparse fields follow the `selectedDraftHookId`/`togglePresetId`
  allow-list pattern end-to-end (client + server).

## Sources

Memory: `hydration-revision-drop-gotcha`, `phase9-guard-optimistic-write-gap`,
`new-scalar-settings-key-hydration`, `per-chat-sparse-field-pattern`,
`archived-workstreams-map` (deferred SSE decisions),
`uiux-issue-audit-round4-2026-07-18` (patterns 3, 6). Archive:
`.archived-docs/protocol-and-persistence/` (lazy projection, mutation-range
narrowing, server-client protocol audits).
