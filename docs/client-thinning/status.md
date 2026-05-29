# Client Thinning Status

Date: 2026-05-30

Status router for the Fastify-only client-thinning workstream. The codebase is
the source of truth; detailed inventories live in the shards.

## Current Snapshot

Implemented / closed:

- Fastify-served web mode is the supported runtime; it injects the browser
  marker (`globalThis.__FASTIFY__`) when serving the SPA.
- Durable resource mutation is command-backed for the major resource families
  (`baseRevision`, 409 conflict, single revision bump, command events).
- The active-writer guard protects server-owned mutation routes; the projection
  write guard freezes `DBState.db` outside trusted projection writes.
- Provider dispatch is server-routed in Fastify mode for supported shapes;
  unsupported shapes fail explicitly (no browser fallback). The provider-routing
  **decision** is single-sourced (2026-05-30, decision #5) in the shared pure
  `resolveProviderCapability` table (`src/ts/process/request/providerCapability.ts`),
  consumed by both the browser completion classifier and the server `/chat`
  dispatcher, so they cannot drift; the stale `reverse_proxy` + `reverseProxyOobaMode`
  `/chat` rejection is gone. See
  [`reference/provider-capability-table.md`](reference/provider-capability-table.md).
- `resolveServerPromptAssembly` is landed and `useServerPromptAssembly` now
  **defaults `true`** (2026-05-30, decision #1): server prompt assembly is the
  supported default and the documented `unsupported` classes hard-fail by default.
  Tests exercising local assembly set the flag `false` explicitly; see
  [`phases/phase-5-closeout.md`](phases/phase-5-closeout.md#closeout-decisions-2026-05-30)
  decision #1.
- Multimodal/asset prompt inlining is server-side at parity for image-input
  models; non-vision image caption fallback hard-fails as unsupported.
- Image-gen / emotion view instruction assembly is server-side at parity
  (slice 3c); the actual image-generation call and inlay rendering remain B1
  browser effects.
- Assembly-time scriptstate persistence (C-A1) is server-owned by
  `/generate/chat`; the browser applies the patch as projection and reconciles
  the returned revision instead of re-POSTing that delta.
- The server Lua VM and prompt-assembly hooks are landed: `editRequest`,
  `editprocess`, input-trigger, and `editinput` run server-side for
  non-interactive Lua; interactive Lua dialog APIs stay `unsupported`.
- A2 is landed on the server-dispatch path: `runServerPostGeneration` runs the
  run-var pass, `runTrigger(..., 'output', ...)`, and `editoutput`; the route
  persists the derived scriptstate delta and returns final text / resend /
  revision on `done.postGeneration` when derivation succeeds. Derivation errors
  are swallowed by `/generate/chat`; the browser does not run a local derivation
  fallback on that path. Decided 2026-05-30 to keep this best-effort (TODO at
  `buildPostGenerationFrame`); see decision #2.
- Bootstrap projection, command-event invalidation, `.risu` import/export/bundle,
  asset routes, backup/restore, and provider secret masking are closed.
- The client-thinning audit is wired as `pnpm client-thinning:audit` and its
  fixture reproducibility is complete (22 rules, 55 tests). The four known
  defeated shallow rules were hardened on 2026-05-30, and the group-chat removal
  added the `A4R-group-chat-removed` invariant.

Resolved A-items (see [`plan.md`](plan.md) for the full classification):

- **A1** prompt-assembly content parity — closed for current scope. PluginV2
  edit/replacer hooks, interactive Lua dialog APIs, and non-vision image caption
  fallback remain explicit `unsupported`. `useServerPromptAssembly` now **defaults
  `true`** (2026-05-30, decision #1), so server prompt assembly is the default
  production path and those `unsupported` classes hard-fail by default. See decision #1.
- **A2** post-generation durable derivation — closed on the server-dispatch path
  by slice 4. Browser derivation remains only on the local-assembly/completion
  path while the prompt-assembly flag is off.
- **A3** provider coverage — closed for current scope; unsupported shapes
  already hard-fail.

Fine in the browser (not blockers): **B1** permanent client-owned effects, and
**B2** orchestration/command-replay that the browser may keep. See
[`status/client-owned-unsupported.md`](status/client-owned-unsupported.md).

Legacy / removed: **group chat** is fully legacy. Its dead `type === 'group'` UI
branches (the `GridCatalog.svelte` group icon and the `ChatList.svelte` new-chat
member seeding) and the vestigial catalog `type` field were removed 2026-05-30, and
`A4R-group-chat-removed` guards against reintroduction. The defense layers stay
(load-time filter, server prompt-assembly hard-fail, `isGroupChat: false`), and
`Message.saying` is kept (still single-character speaker attribution); the
load-time filter / `saying` fate remains a separate decision. Event patching stays
deferred. Flags: `useServerGeneration` removed (2026-05-29); `isFastifyServer` and
`useServerPromptAssembly` kept and annotated in-code, not deprecated.

Caveat on the audit: reproducible but not uniformly robust — some rules still use
source-text needles/regex counts. The four empirically defeated rules are now AST
invariants; hardening any remaining shallow rule requires first demonstrating a
sincere defeat against the real binary. See [`status/audit.md`](status/audit.md).

## Active Direction

- Treat A1/A2 implementation as landed, but the workstream as not closed out.
- Start with the audit. If `pnpm client-thinning:audit` is red, fix or triage
  before wider runtime changes; then record in
  [`coverage/latest-verification.md`](coverage/latest-verification.md).
- Group-chat UI-branch removal is landed (2026-05-30). Remaining group-chat items
  are deliberately separate decisions: the load-time group filter / `Message.saying`
  fate, and any stale group-chat strings/comments in unrelated surfaces
  (`removeFromGroup` lang key, `cbs.ts` / `risuai.d.ts` doc comments). Additional
  audit-rule hardening is only opened after a demonstrated defeat. Keep event
  patching deferred until SSE reconnect/replay exists.

## Start Here

- [Overview](status/overview.md) — phase language and main entry points.
- [Next steps](status/next-steps.md) — prioritized work order.
- [sendChat / chat-process ownership](status/sendchat-thinning.md) — the detailed
  A/B blocker triage.
- [Server projection](status/server-projection.md) — bootstrap, guard, events
  (event patching deferred).
- [Audit](status/audit.md) — reproducibility done; four defeated rules hardened.
- [Command boundaries](status/command-boundaries.md) — closed/stable.
- [Assets, imports, backups](status/assets-imports-backups.md) — closed/stable.
- [Client-owned / legacy](status/client-owned-unsupported.md) — B1 keep, group
  chat remove.
