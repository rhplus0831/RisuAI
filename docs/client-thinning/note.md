# Client Thinning Note

Date: 2026-05-29

Short handoff for the Fastify-only client-thinning workstream. Start with
[`status.md`](status.md), [`plan.md`](plan.md), and only the shard for the
behavior being changed.

## Latest Change

The newest code change is `2883e8a2` (`feat: land server Lua VM runtime (slice
3b sub-slice 1)`). It added `server/fastify/src/prompt/luaRuntime.ts` and
`server/fastify/__tests__/luaRuntime.test.ts`. Scope is runtime only: the
classifier still routes Lua sends `unsupported` because `editRequest`,
`editprocess`, and input-trigger/`editinput` are not wired into server assembly.

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
2. Lua sub-slice 3b-2: wire VM-backed `editRequest`.
3. Lua sub-slices 3b-3/3b-4: `editprocess`, then input-trigger/`editinput`.
4. Slice 3c: image-gen view instruction.
5. A2: server output-trigger + `editoutput`.
6. Group-chat legacy removal.
7. Audit-rule hardening (A4R2, A4R7, fanout-svelte, EC2).
8. Event patching stays deferred.

## Batching Policy

- One coherent batch; do not mix blocker classes or group-chat removal in one
  review.
- Write a compact scope: invariant, owner, timing, inputs, allowed mutations,
  persistence, errors, rollback, active-writer behavior, projection refresh, proof.
- Update docs after the code and proof are complete.
