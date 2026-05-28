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

1. **A1 foundation — prompt-assembly classifier.** Build
   `resolveServerPromptAssembly` (`server | local | unsupported`, mirroring
   `resolveServerCompletionRoute`) and replace the `useServerPromptAssembly`
   runtime gate. Make the supported text-send subset server-mandatory (single
   non-group character, server-routable provider, no asset/image-gen/Lua/plugin
   content). Proof: `assembleLocalSendChatPrompt` is unreachable for the subset.
2. **C-A1 — server-side scriptstate persistence.** Move assembly-time chat-var
   persistence into `/generate/chat`; retire the command replay. No parity
   blocker; smallest real post-gen batch.
3. **A1 content classes, one batch each** — multimodal/asset inlining, then
   Lua/plugin-V2 + input scripts, then image-gen instruction. Each graduates its
   send shape from `unsupported` to server-mandatory.
4. **A2 — server output-trigger + `editoutput`.** Needs server output-script
   execution; sequence after A1's Lua/plugin parity.
5. **Group-chat legacy removal.** Separate from thinning — inventory and remove
   the client surface (see [`client-owned-unsupported.md`](client-owned-unsupported.md)).
6. **Audit-rule hardening.** Convert A4R2, A4R7, the fanout `.svelte` path, and
   EC2 from string/regex to AST invariants; add adversarial fixtures
   ([`audit.md`](audit.md)).
7. Documentation-only reconciliation when code and docs drift without behavior
   change.

## Blocked / No-Port

- **Event patching stays deferred** until the SSE reconnect/replay gap is closed
   (precondition). Do not ship a surgical applier before that.
- Do not add browser provider fallback in Fastify mode.
- Do not add a server group-chat model; group chat is legacy.
- Do not reopen native/mobile wrappers, service workers, peer/Drive/Account sync,
  or removed memory engines; do not add server-side plugin code execution.

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
