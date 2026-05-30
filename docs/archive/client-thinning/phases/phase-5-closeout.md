# Phase 5: Closeout

Date: 2026-05-30

Status: active closeout. A-items, the known audit-hardening batch, and the
group-chat UI-branch removal are done. The open closeout decisions were resolved
2026-05-30 (see [Closeout Decisions](#closeout-decisions-2026-05-30)). Both
former closeout implementation batches — the provider-resolver unification (#5) and the
`useServerPromptAssembly` default flip (#1) — **landed 2026-05-30** (see
[`../coverage/latest-verification.md`](../coverage/latest-verification.md) and
[`../reference/provider-capability-table.md`](../reference/provider-capability-table.md));
the remaining decisions are keep-as-is, defer, or hand-off.

## Exit Criteria

| Criterion | Current status | Closeout requirement |
| --- | --- | --- |
| A1/A2/A3 blockers | **Done.** A1 content graduation (3a/3b/3c), A2 post-generation derivation (slice 4), and A3 hard-fail provider support cap are resolved. | Keep hard-fails explicit; do not reintroduce silent browser fallback. |
| Group-chat legacy removal | **UI branches done (2026-05-30).** The dead `type === 'group'` branches in `GridCatalog.svelte` / `ChatList.svelte` and the vestigial catalog `type` field were removed; `A4R-group-chat-removed` guards them and the three defense layers. Residual: `Message.saying` / load-time filter fate (separate decision) and stale group strings/comments in unrelated surfaces (optional docs-only). | Keep the defense layers and the invariant green; treat residual items as separate, scoped tasks. See [`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md). |
| Audit-rule hardening | **Done for known defeats.** `A4R2`, `A4R7`, fanout `.svelte`, and `EC2` are AST invariants with adversarial fixtures. | Additional hardening only after a sincere defeat of another shallow rule. |
| Prompt-assembly default flip (#1) | **Landed 2026-05-30.** `useServerPromptAssembly` now defaults `true` (`database.svelte.ts`); the documented `unsupported` content classes hard-fail by default. The browser server-backed *completion*-dispatch sweep opts the flag `false` explicitly. | Keep the hard-fails explicit; tests exercising local assembly set the flag `false`. See decision #1. |
| Provider resolver unification (#5) | **Landed 2026-05-30.** The completion and `/chat` resolvers share one `resolveProviderCapability` table; the stale `reverse_proxy` + ooba `/chat` rejection is gone. Guarded by the `A4R-provider-capability` invariant. | One shared source of truth; see [`../reference/provider-capability-table.md`](../reference/provider-capability-table.md) and decision #5. |
| Event patching | **Decided: keep invalidation model for now (#8).** Command events stay invalidation-only; the browser does a debounced full-projection refetch. | Keep unless it blocks other work; if revisited, ship only after SSE reconnect + `Last-Event-ID` replay are specified and tested. See decision #8. |
| Verification/docs | **Ongoing.** | Latest verification batch is recorded in [`../coverage/latest-verification.md`](../coverage/latest-verification.md), and status/coverage shards match current source. |

## Closeout Decisions (2026-05-30)

The open closeout decisions were resolved by the owner on 2026-05-30. This is the
canonical record; other shards link here.

1. **Prompt-assembly default (`useServerPromptAssembly`).** Decided: **flip the
   default to `true`** so server prompt assembly is the default supported path, with
   tests / specific cases able to set it `false` explicitly. **Landed 2026-05-30**:
   the `database.svelte.ts` coercion now defaults `true`, so the documented
   `unsupported` content classes (non-vision image caption, interactive Lua dialogs,
   pluginV2 edit/replacer hooks) hard-fail by default. The test sweep set `false` only
   where a suite exercises local assembly — the one site was the browser server-backed
   *completion*-dispatch sweep (`sendChat.fixtures.serverBacked.test.ts`), which by
   design uses local prompt assembly + server completion dispatch. Pairs with #5 (the
   flag-on classifier routes via the shared capability table, then dispatches via
   `/chat`).
2. **A2 post-generation failure policy.** Decided: **keep best-effort.** A thrown
   `runServerPostGeneration` is swallowed (no `done.postGeneration` frame, no browser
   fallback derivation) so a healthy completion still terminates cleanly. A TODO at
   `server/fastify/src/routes/generationChat.ts` (the `buildPostGenerationFrame`
   catch) records "for now, this is handled on a best-effort basis." Revisit only if
   a stricter hard-fail/restore or retry contract is needed.
3. **`Message.saying`.** Decided: **keep — do not force removal.** It remains the
   active single-character speaker-attribution field (prompt history, lorebook,
   export, post-gen); removal stays gated on a designed replacement model.
4. **Load-time group filter.** Decided: **keep as-is.** `setDatabase` keeps the
   `type !== 'group'` filter; `A4R-group-chat-removed` (P1) enforces it stays.
5. **Provider resolver parity.** Decided: **unify onto a single source of truth.**
   `resolveServerCompletionRoute` (completion path) and the `chatDispatch.ts`
   resolver (`/chat` path) become one shared provider-capability table both consume,
   eliminating drift (known divergence: `reverse_proxy` + `reverseProxyOobaMode` —
   the completion path accepts it, `/chat` rejects it). **Landed 2026-05-30**: the
   shared pure `resolveProviderCapability` (`src/ts/process/request/providerCapability.ts`)
   owns the decision; both files consume it, the ooba divergence is resolved toward
   ACCEPT (the openai adapter honors `oobaSystemHoist`), and the `A4R-provider-capability`
   audit invariant forbids re-forking. The `db→modelInfo` derivation (registry vs
   string-prefix) and the per-path reason prose stay per-side, and the server-only
   unknown-OpenAI-compatible-id guard is kept. See
   [`../reference/provider-capability-table.md`](../reference/provider-capability-table.md).
6. **Stale group strings/comments.** Decided: **defer to the final cleanup pass.**
   The dead `removeFromGroup` lang key, the `cbs.ts` `{{char}}` description, and the
   `risuai.d.ts` "and group chats" comment are removed in the closeout cleanup pass,
   not as a standalone task now.
7. **Route-direct final-message persistence.** Decided: **hand off to the
   durable-generation workstream.** Removed from client-thinning closeout scope; the
   route-owned assistant-message write, double-write avoidance, and reconnect/read
   semantics are designed there (see [`../plan.md`](../plan.md) "Out Of Scope Here").
8. **Event patching.** Decided: **keep the current invalidation model for now.** As
   long as the debounced full-projection refetch is not blocking or interfering with
   other work, leave it; revisit (with the SSE reconnect + `Last-Event-ID` replay
   precondition) only if it becomes a constraint.

See [`../plan.md`](../plan.md) for the spine.
