# Client Thinning Note

Date: 2026-05-29

Short handoff for the Fastify-only client-thinning workstream. Start with
[`status.md`](status.md), [`plan.md`](plan.md), and only the shard for the
behavior being changed.

## Latest Change

The newest code change is `0e724222` (`feat: wire server Lua input-trigger +
editinput at submit (slice 3b sub-slice 4)`). It completed the Lua server-port
series: the VM runs `editRequest`, `editprocess`, the submit-time input trigger,
and `editinput`; `/generate/chat` owns the post-`editinput` transcript write
when a submit hook changes it. Interactive Lua dialog APIs remain
`unsupported`.

Already landed before that: `resolveServerPromptAssembly` (text subset
server-mandatory when the flag is on), C-A1 route-owned assembly-time
scriptstate persistence, multimodal/asset inlining for image-input models, and
pluginV2 permanent unsupported.

## Latest Verification

See [`coverage/latest-verification.md`](coverage/latest-verification.md) for the
current recorded commands and results.

## Current State

- Default Fastify chat flow: browser assembles the prompt
  (`useServerPromptAssembly` off), server makes the LLM call (platform-gated),
  browser orchestrates post-gen, and final-message persistence still uses a
  browser-issued command. When server prompt assembly is enabled,
  `/generate/chat` now persists assembly-time scriptstate itself.
- Closed: command boundary, bootstrap projection + command-event invalidation,
  `.risu` import/export/bundle, asset routes + reference validation, backup/
  restore, provider secret masking, supported-provider server dispatch.
- Audit reproducibility is complete (21 rules, 45 tests), but several rules are
  shallow and four were empirically defeated by sincere refactors. See
  [`status/audit.md`](status/audit.md).

## Next Delta Target

Follow the work order in [`plan.md`](plan.md):

1. Run the audit; fix/triage if red.
2. Slice 3c: image-gen view instruction.
3. A2: server output-trigger + `editoutput`.
4. Group-chat legacy removal.
5. Audit-rule hardening (A4R2, A4R7, fanout-svelte, EC2).
6. Event patching stays deferred.

## Batching Policy

- One coherent batch; do not mix blocker classes or group-chat removal in one
  review.
- Write a compact scope: invariant, owner, timing, inputs, allowed mutations,
  persistence, errors, rollback, active-writer behavior, projection refresh, proof.
- Update docs after the code and proof are complete.
