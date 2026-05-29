# Phase 5: Closeout

Date: 2026-05-30

Status: active closeout. A-items, the known audit-hardening batch, and the
group-chat UI-branch removal are done; the group-chat `Message.saying` / load-time
filter fate stays a separate decision; event patching remains deferred.

## Exit Criteria

| Criterion | Current status | Closeout requirement |
| --- | --- | --- |
| A1/A2/A3 blockers | **Done.** A1 content graduation (3a/3b/3c), A2 post-generation derivation (slice 4), and A3 hard-fail provider support cap are resolved. | Keep hard-fails explicit; do not reintroduce silent browser fallback. |
| Group-chat legacy removal | **UI branches done (2026-05-30).** The dead `type === 'group'` branches in `GridCatalog.svelte` / `ChatList.svelte` and the vestigial catalog `type` field were removed; `A4R-group-chat-removed` guards them and the three defense layers. Residual: `Message.saying` / load-time filter fate (separate decision) and stale group strings/comments in unrelated surfaces (optional docs-only). | Keep the defense layers and the invariant green; treat residual items as separate, scoped tasks. See [`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md). |
| Audit-rule hardening | **Done for known defeats.** `A4R2`, `A4R7`, fanout `.svelte`, and `EC2` are AST invariants with adversarial fixtures. | Additional hardening only after a sincere defeat of another shallow rule. |
| Event patching | **Deferred.** Command events remain invalidation-only; no reconnect/replay contract exists. | Either ship after SSE reconnect + `Last-Event-ID` replay are specified and tested, or keep docs explicit that patching is deferred and unsupported. |
| Verification/docs | **Ongoing.** | Latest verification batch is recorded in [`../coverage/latest-verification.md`](../coverage/latest-verification.md), and status/coverage shards match current source. |

See [`../plan.md`](../plan.md) for the spine.
