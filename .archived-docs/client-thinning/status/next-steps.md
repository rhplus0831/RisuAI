# Next Steps

Date: 2026-05-30

Read this when choosing the next client-thinning batch. Full classification in
[`../plan.md`](../plan.md); detailed triage in
[`sendchat-thinning.md`](sendchat-thinning.md).

## Start Point

- Run `pnpm client-thinning:audit`. If red, fix or explicitly triage before
  selecting runtime work; if this is the recordable verification for the batch,
  record the command/result in
  [`../coverage/latest-verification.md`](../coverage/latest-verification.md).
- Before editing runtime code, write a compact scope: invariant, owner, timing,
  inputs, allowed mutations, persistence, errors, rollback, active-writer
  behavior, projection refresh, and proof command.

## Prioritized Work Order

Completed context: slice 1 (`resolveServerPromptAssembly`), slice 2 (C-A1),
slice 3a (multimodal/asset on image-input models), pluginV2 permanent
unsupported, all slice 3b Lua sub-slices, slice 3c (image-gen view instruction),
and **slice 4 (A2 — server output-trigger + `editoutput`)** have landed. **All
A-blockers (A1/A2/A3) are now resolved.** Both former closeout implementation
batches also landed 2026-05-30: the **provider-resolver unification (#5)** (shared
`resolveProviderCapability` table) and the **`useServerPromptAssembly` default flip
(#1)** (now defaults `true`).

1. ~~**Group-chat legacy removal.**~~ UI-branch removal DONE 2026-05-30. The dead
   `type === 'group'` branches in `GridCatalog.svelte` / `ChatList.svelte` and the
   vestigial catalog `type` field were removed and are guarded by the new
   `A4R-group-chat-removed` invariant (see [`audit.md`](audit.md)). As planned, the
   `Message.saying` attribution field and the load-time group filter were kept by
   decisions #3/#4. The remaining group cleanup scope is decision #6's stale group
   references in unrelated surfaces (`removeFromGroup` lang key, `cbs.ts` /
   `risuai.d.ts` comments). See [`client-owned-unsupported.md`](client-owned-unsupported.md).
2. ~~**Audit-rule hardening.**~~ DONE 2026-05-30 — A4R2, A4R7, the fanout `.svelte`
   path, and EC2 are now AST invariants with adversarial fixtures ([`audit.md`](audit.md)).
   Remaining audit work is only the other still-shallow string/regex rules, and it
   is gated on first demonstrating a sincere defeat against the real binary.
3. ~~**Provider resolver unification (decision #5).**~~ DONE 2026-05-30. Collapsed
   `resolveServerCompletionRoute` and the `chatDispatch.ts` resolver onto one shared
   pure `resolveProviderCapability` table; the `reverse_proxy` + Ooba divergence is
   resolved (both accept). Guarded by the `A4R-provider-capability` invariant; spec at
   [`../reference/provider-capability-table.md`](../reference/provider-capability-table.md).
4. ~~**`useServerPromptAssembly` default flip (decision #1).**~~ DONE 2026-05-30. The
   flag defaults `true`; the documented `unsupported` content classes hard-fail by
   default. The only suite touched by the sweep was the browser server-backed
   *completion*-dispatch fixtures (now opt the flag `false` explicitly, as that path
   uses local assembly + server completion).
5. Documentation-only reconciliation when code and docs drift without behavior
   change. (With #3/#4 landed, the remaining closeout item is decision #6 stale
   group strings/comments; event-patching and shallow-audit-rule work stay
   deferred/gated. See the deferred section.)

## Closeout Decisions — Resolved 2026-05-30

These were the open closeout decisions; the owner resolved them on 2026-05-30. The
canonical record (with rationale and landed/deferred status) is
[`../phases/phase-5-closeout.md`](../phases/phase-5-closeout.md#closeout-decisions-2026-05-30).
Summary:

- **Prompt-assembly default (#1).** Decided and landed: `useServerPromptAssembly`
  defaults `true`; tests/specific cases may set `false`.
- **A2 derivation failure policy (#2).** Decided: keep best-effort — a thrown
  `runServerPostGeneration` is swallowed (no frame, no browser fallback). TODO added
  at `generationChat.ts` (`buildPostGenerationFrame` catch).
- **`Message.saying` (#3).** Decided: keep; removal stays gated on a replacement
  attribution model.
- **Load-time group filter (#4).** Decided: keep as-is (enforced by
  `A4R-group-chat-removed` P1).
- **Provider resolver parity (#5).** Decided and landed: a single shared
  provider-capability table eliminates the `reverse_proxy` + Ooba divergence.
- **Stale group strings/comments (#6).** Decided: defer to the final cleanup pass
  (`removeFromGroup` lang key, `cbs.ts` / `risuai.d.ts` comments).
- **Route-direct final-message persistence (#7).** Decided: handed to the
  durable-generation workstream; out of client-thinning closeout scope.
- **Event patching (#8).** Decided: keep the invalidation model for now; revisit
  (with the reconnect/`Last-Event-ID` replay precondition) only if it blocks other
  work.

Standing guidance (not a decision):

- **Historical no-port list.** Treat it as "do not port or reopen." Do not turn the
  whole list into a closeout blocker. If a live Fastify compatibility surface is
  found, create a named removal/migration task with files and proof.

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
2. Remove one legacy surface, or harden one audit-rule family only after a
   demonstrated defeat; keep docs-only reconciliation separate from behavior
   changes.
3. Update docs after code and proof are complete.
