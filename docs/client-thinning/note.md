# Client Thinning Note

Date: 2026-05-30

Short handoff for the Fastify-only client-thinning workstream. Start with
[`status.md`](status.md), [`plan.md`](plan.md), and only the shard for the
behavior being changed.

## Latest Change

The newest change (uncommitted on `fastify`) is the **group-chat legacy removal**.
It deleted the two dead `type === 'group'` UI branches — the `GridCatalog.svelte`
group icon and the `ChatList.svelte` new-chat member seeding — plus the vestigial
catalog `formatChars` `type` field and the now-unused `Users` / `findCharacterbyId`
imports. The three defense layers are kept (load-time filter, server prompt-assembly
hard-fail, `isGroupChat: false`) and `Message.saying` is untouched. Proof is the new
`A4R-group-chat-removed` AST invariant (negative: no `char.type === 'group'` in the
catalog/chat-list surfaces; positive: the three layers remain) with three committed
fixtures; the audit fixture suite is now 55 tests across 22 rules.

The previous code change is `75082c48` (`refactor: harden 4 client-thinning audit
rules to AST invariants`). It converted the four known defeated audit rules
(`A4R2`, `A4R7`, the fanout `.svelte` path, and `EC2`) into AST-backed invariants
with adversarial fixtures.

The newest runtime change is `fb279717` (`feat: server post-generation output
trigger + editoutput (slice 4 / A2)`). It landed `runServerPostGeneration` on the
server-dispatch path: run-var pass, `runTrigger(..., 'output', ...)`, and
`editoutput`, with the scriptstate delta persisted and final text / resend /
revision returned on `done.postGeneration`.

Immediately before that, `aea3db46` landed the slice 3c image-gen / emotion view
instruction in the server assembler. Earlier A1/C-A1 work is also landed:
`resolveServerPromptAssembly`, route-owned assembly-time scriptstate persistence,
multimodal/asset inlining for image-input models, non-interactive Lua edit/input
hooks, and pluginV2 permanent unsupported.

## Latest Verification

See [`coverage/latest-verification.md`](coverage/latest-verification.md) for the
current recorded commands and results.

## Current State

- Default Fastify chat flow: browser assembles the prompt
  (`useServerPromptAssembly` off), server makes the LLM call (platform-gated),
  browser orchestrates post-gen, and final-message persistence still uses a
  browser-issued command. When server prompt assembly is enabled,
  `/generate/chat` now owns assembly-time scriptstate and the server-side A2
  post-generation derivation when that derivation succeeds; derivation failures
  currently produce no `done.postGeneration` frame and do not fall back to browser
  derivation.
- Closed: command boundary, bootstrap projection + command-event invalidation,
  `.risu` import/export/bundle, asset routes + reference validation, backup/
  restore, provider secret masking, supported-provider server dispatch, and all
  A1/A2 chat-process blockers.
- Audit reproducibility is complete (22 rules, 55 tests). The four empirically
  defeated rules are hardened; the group-chat removal added `A4R-group-chat-removed`;
  remaining shallow rules are optional follow-up only after a sincere defeat is
  demonstrated. See [`status/audit.md`](status/audit.md).

## Next Delta Target

Follow the work order in [`plan.md`](plan.md):

1. Run the audit; fix/triage if red.
2. Group-chat UI-branch removal is landed. Remaining group-chat work is separate
   decisions: the load-time filter / `Message.saying` fate, and the stale
   group-chat strings/comments in unrelated surfaces (`removeFromGroup` lang key,
   `cbs.ts` / `risuai.d.ts` doc comments) — out of the UI-branch scope, optional
   docs-only follow-up.
3. Documentation-only reconciliation when code/docs drift.
4. Additional audit-rule hardening only after a concrete defeat is demonstrated.
5. Event patching stays deferred until SSE reconnect/replay exists.

## Batching Policy

- One coherent batch; keep group-chat removal, any newly justified audit-rule
  hardening, event-patching, and docs-only reconciliation separate.
- Write a compact scope: invariant, owner, timing, inputs, allowed mutations,
  persistence, errors, rollback, active-writer behavior, projection refresh, proof.
