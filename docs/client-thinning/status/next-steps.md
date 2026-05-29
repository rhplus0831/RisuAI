# Next Steps

Date: 2026-05-29

Read this when choosing the next client-thinning batch. Full classification in
[`../plan.md`](../plan.md); detailed triage in
[`sendchat-thinning.md`](sendchat-thinning.md).

## Start Point

- Run `pnpm client-thinning:audit`. If red, fix or explicitly triage before
  selecting runtime work; if green, record in
  [`../coverage/latest-verification.md`](../coverage/latest-verification.md).
- Before editing runtime code, write a compact scope: invariant, owner, timing,
  inputs, allowed mutations, persistence, errors, rollback, active-writer
  behavior, projection refresh, and proof command.

## Prioritized Work Order

Completed context: slice 1 (`resolveServerPromptAssembly`), slice 2 (C-A1),
slice 3a (multimodal/asset on image-input models), pluginV2 permanent
unsupported, all slice 3b Lua sub-slices, slice 3c (image-gen view instruction),
and **slice 4 (A2 — server output-trigger + `editoutput`)** have landed. **All
A-blockers (A1/A2/A3) are now resolved.**

1. **Group-chat legacy removal.** Separate from thinning — inventory and remove
   the client surface (see [`client-owned-unsupported.md`](client-owned-unsupported.md)).
2. **Audit-rule hardening.** Convert A4R2, A4R7, the fanout `.svelte` path, and
   EC2 from string/regex to AST invariants; add adversarial fixtures
   ([`audit.md`](audit.md)).
3. Documentation-only reconciliation when code and docs drift without behavior
   change.

## Blocked / No-Port

- **Event patching stays deferred** until the SSE reconnect/replay gap is closed
   (precondition). Do not ship a surgical applier before that.
- Do not add browser provider fallback in Fastify mode.
- Do not add a server group-chat model; group chat is legacy.
- Do not reopen native/mobile wrappers, service workers, peer/Drive/Account sync,
  or legacy memory/sync surfaces outside this plan; do not add server-side plugin
  code execution.

## Closed Areas

Treat as closed unless source inventory proves drift: command foundation and
resource families, bootstrap projection + command-event invalidation, `.risu`
import/export/bundle, asset routes + reference validation baseline, backup/restore,
provider secret masking, and supported-provider server dispatch.

## Selection Order

1. Prove or fix the audit baseline.
2. Remove one named browser branch with a server contract and proof, or remove one
   legacy surface — never both in one batch.
3. Update docs after the code and proof are complete.
