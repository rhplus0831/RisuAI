# Phase 5: Closeout

Date: 2026-05-30

Status: active closeout. A-items and the known audit-hardening batch are done;
group-chat removal remains open; event patching remains deferred.

## Exit Criteria

| Criterion | Current status | Closeout requirement |
| --- | --- | --- |
| A1/A2/A3 blockers | **Done.** A1 content graduation (3a/3b/3c), A2 post-generation derivation (slice 4), and A3 hard-fail provider support cap are resolved. | Keep hard-fails explicit; do not reintroduce silent browser fallback. |
| Group-chat legacy removal | **Open.** Groups are filtered and `/chat` does not model them, but UI/type compatibility surface remains. | Remove the scoped client surface, with proof listed in [`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md). |
| Audit-rule hardening | **Done for known defeats.** `A4R2`, `A4R7`, fanout `.svelte`, and `EC2` are AST invariants with adversarial fixtures. | Additional hardening only after a sincere defeat of another shallow rule. |
| Event patching | **Deferred.** Command events remain invalidation-only; no reconnect/replay contract exists. | Either ship after SSE reconnect + `Last-Event-ID` replay are specified and tested, or keep docs explicit that patching is deferred and unsupported. |
| Verification/docs | **Ongoing.** | Latest verification batch is recorded in [`../coverage/latest-verification.md`](../coverage/latest-verification.md), and status/coverage shards match current source. |

See [`../plan.md`](../plan.md) for the spine.
