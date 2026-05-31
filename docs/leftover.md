# Leftover Items — closed Fastify workstreams

Date: 2026-05-30

Canonical list of items that still need an owner decision or were intentionally
deferred, after the **client-thinning**, **durable-generation (Milestone 1)**, and
**lazy-projection** workstreams were implemented and archived. Each entry names what
it is, why it is not done, and the trigger that would make it actionable.

This file supersedes the former `docs/deferred.md` (folded in below). The source
workstream docs now live under [`archive/client-thinning/`](archive/client-thinning/),
[`archive/durable-generation/`](archive/durable-generation/), and
[`archive/lazy-projection/`](archive/lazy-projection/).

The codebase is the source of truth. Where a claim cites a file, it was verified
against the tree on 2026-05-31 (branch `fastify`).

---

## Resolved during this audit (2026-05-30)

- **Client-thinning audit was RED — found and fixed.** The durable-generation work
  added `DELETE /api/v1/generate/chat/:id` (cancel) and classified it in
  `server/fastify/src/activeWriter.ts:63`, but never added the matching entry to the
  EC5 audit's `MUTATING_ROUTE_RULES` table, so `pnpm client-thinning:audit` exited 1
  with "Unclassified mutating Fastify route: DELETE /api/v1/generate/chat/:id" — while
  every status doc claimed the audit passed. Fixed by adding the `active-writer` rule
  entry (`util/client-thinning-audit.ts`) plus the route + needle in both EC5 fixtures
  (`util/client-thinning-audit-fixtures/active-writer-guard/{classified-bypass,failing-unclassified-route}/`).
  Audit now green; `util/client-thinning-audit.test.ts` is 58/58.
- **Durable post-gen failure policy — was marked OPEN, actually implemented.** The
  draft (Step 3 gotcha F) and `deferred.md` listed this as undecided; it is implemented
  in `buildDurablePostGeneration` (`server/fastify/src/routes/generationChat.ts`):
  derivation throw → persist raw + `warning`; persist throw (chat gone/changed) → job
  `error`. Docs reconciled.
- **Durable `/chat` writer/423 gate location — resolved.** The gate is the global
  active-writer `preHandler` in `server/fastify/src/activeWriter.ts`;
  `isServerOwnedMutation()` includes `POST /api/v1/generate/chat`,
  `/api/v1/generate/preview-prompt`, and `DELETE /api/v1/generate/chat/:id`.
- **Doc count contradictions — fixed.** Stale "22 rules / 55 tests" mentions in
  `phases/slices/README.md` and `reference/proof-points.md` corrected to the real
  **23 checks / 58 tests**.
- **Lazy projection audit closed.** The source/history audit confirmed the non-lorebook
  lazy-projection work landed: server-side asset GC, surgical inbound sync,
  server-owned generation result writes, SQLite chat messages + per-chat `hypaV3Data`,
  chat-stub bootstrap + hydration, durable `continue`/`regenerate`, persisted reroll
  alternates, and browser auto-reattach. The plan is archived under
  [`archive/lazy-projection/`](archive/lazy-projection/).
- **Stale durable-generation follow-ups resolved by lazy projection.** Browser
  auto-reattach now consumes `activeGenerationJobs`; durable generation now includes
  `send`, `continue`, and `regenerate`; contiguous command events use targeted
  projection fetches instead of a debounced full-bootstrap refresh.

## Resolved during follow-up (2026-05-31)

- **DevTool scriptstate editing no longer bypasses server commands.** The variable
  editor in `src/lib/SideBars/DevTool.svelte` now commits string/number/boolean
  changes through the chat scriptstate command helper instead of binding inputs
  directly into `DBState.db.characters[...].chats[...].scriptstate[...]`. The
  client guard is backed by a focused test and a dedicated audit check
  (`A4R-devtool scriptstate command-backed`).
- **Fastify-mode inlay bytes no longer remain browser-local.** Inlay images,
  audio/video, and signature payloads created in server-backed mode are uploaded
  through `/api/v1/assets` and referenced by content-addressed asset id. Legacy
  browser-local inlay ids are uploaded once and sent to `/generate/chat` only as
  id-to-asset-id aliases; prompt assembly resolves bytes from `data/assets/`.
  Asset GC and bundle export now hydrate chat messages so inlay-token references
  are counted with the rest of the asset graph.
- **`useServerPromptAssembly` flag removed.** Fastify-mode prompt assembly no
  longer has a flag-off browser-local escape hatch: `resolveServerPromptAssembly()`
  returns `local` only outside Fastify mode, server settings no longer expose the
  flag, legacy persisted values are normalized away on server import/defaulting,
  and `pnpm client-thinning:audit` now guards against reintroducing it.

---

## Client-thinning — open items

### Needs a decision

- **`Message.saying` field fate / load-time group filter.** Decision #3 keeps
  `Message.saying` (single-character speaker attribution; removal gated on a designed
  replacement attribution model). Decision #4 keeps the `setDatabase` `type !== 'group'`
  load filter (enforced by `A4R-group-chat-removed`). Trigger: a designed
  speaker-attribution replacement is specified.
- **Lua server VM security model is single-user self-host only.** The egress guard +
  exec limits (incl. the 30/min request window) are scaled to "your own code on your
  own box." A hosted/multi-tenant deployment needs a much higher bar (egress
  allow-list, per-tenant isolation, possibly `worker_threads`). Trigger: deciding to
  ship a hosted/multi-tenant Fastify deployment.
  Source: `archive/client-thinning/phases/slices/slice-3b-lua/README.md`.

### Intentionally deferred (no action unless the trigger fires)

- **Stale group-chat strings/comments cleanup** (decision #6). Dead `removeFromGroup`
  lang keys (`src/lang/*.ts`), the `src/ts/cbs.ts` `{{char}}` group-name description,
  and the `risuai.d.ts` "and group chats" comment still exist. Deferred to the final
  cleanup pass, not a standalone task. Docs-only; proof = no live behavior change.
- **A2 post-generation derivation is best-effort on the non-durable path.** A thrown
  `runServerPostGeneration` is swallowed (no `done.postGeneration` frame, no browser
  fallback). Code TODO at `server/fastify/src/routes/generationChat.ts` (the
  `buildPostGenerationFrame` catch). Trigger: a stricter hard-fail / restore / retry
  contract is needed.
- **Output-trigger message surgery not durably persisted.** impersonate/cutchat/
  modifychat from an `'output'` trigger are surfaced in the post-gen `message_patch`
  for the projection only, not separately persisted server-side (matches today's
  projection-only behavior). Likewise `editoutput`-that-adds-inlay-markers is an
  ordering edge the terminal pass does not specially reconcile.
- **Lua host functions returning stubbed values.** On the server VM these are deferred
  (`server/fastify/src/prompt/luaRuntime.ts`): `LLM()`/`axLLM()` return an error JSON
  (port path: route through `dispatchChatProvider`), `similarity()` returns `[]`
  (needs server embedding infra), `generateImage`/`getCharacterImage`/`getPersonaImage`
  are no-op/error (B1 image-gen; could reuse slice-3a `resolveStoredAssetImage`),
  `getPersonaDescription()` returns `''`. Trigger: a real char's `triggerlua` needs one
  during a server-assembled send.
- **Non-vision image-caption (content class 2) is permanently unsupported.** No server
  equivalent of the browser-only `runImageEmbedding` captioning pipeline; emitting a
  silently captionless prompt was rejected, so it hard-fails as `unsupported`. Trigger:
  only if a server-side image-captioning pipeline is ever introduced.
- **pluginV2 edit/replacer hooks are permanently unsupported** (no-port; superseded by
  Plugin V3). `hasPluginV2EditSet` never flips to server; guarded by `A4R-pluginv2`.
  Listed as a standing constraint, not a gap.
- **Server provider dispatch can still hard-fail a provider shape the browser
  prompt-assembly preflight accepts** (decision #5 seam). The `db → modelInfo`
  derivation stays per-side (server uses string-prefix, not the `LLMModels`
  registry). Closing it would require replicating the model registry on the server;
  explicitly out of scope for #5.
- **Manual legacy local-client verification** is separate from Fastify projection
  hardening; only opened if a dedicated local-client verification task is created.

### Follow-ups (smaller, gated)

- **Promote the interactive-Lua detection to the precise runtime-abort arm.** Today
  it is a classify-time source scan (`alertInput|alertSelect|alertConfirm` regex →
  `unsupported`); the runtime also flags `interactiveInvoked`. Trigger: a
  false-positive/negative on the regex is observed.
- **Move the remaining shallow string/regex audit rules to AST invariants.** Only the
  four empirically-defeated rules (A4R2, A4R7, A4R-fanout-svelte, EC2) are hardened.
  Trigger: a sincere variant prints "Client-thinning audit passed." against a still-
  shallow rule; then convert that rule + ship adversarial fixtures.
- **Fanout Svelte AST extraction misses quoted-attribute interpolations**
  (`attr="{ ... }"`). It covers `<script>` blocks and `={ ... }` handlers only.
  Trigger: a mutating dispatch site lands inside a quoted attribute interpolation.

---

## Durable generation — remaining open items

- **Milestone 2 — survive a server restart.** M1 jobs are in-memory
  (`GenerationJobRegistry`, lost on restart). Disk-persisting job state/result is
  deferred; a chat generation is short-lived, so restart-survival is low value for a
  single-user self-host. Precedent to study: HypaV3 `memoryRepository` /
  `routes/memoryJobs.ts`. The `StreamJob.writerSessionId` field captured at M1 job
  creation is the hook left for this (currently stored but unused by the completion
  write, which is a server-owned completion of an already-authorized job).

---

## Cross-cutting / infrastructure

- **Vite dev Fastify marker.** `pnpm dev` proxies `/api` but does not inject
  `globalThis.__FASTIFY__`, so `isFastifyServer` is false in dev (only
  `pnpm buildsite` + `pnpm api:start` is true Fastify-backed mode). Decide separately
  whether true Fastify-backed dev needs a documented build/serve flow or a dev-time
  marker injection.
