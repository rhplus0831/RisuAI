# Client Thinning Note

Date: 2026-05-30

Short handoff for the Fastify-only client-thinning workstream. Start with
[`status.md`](status.md), [`plan.md`](plan.md), and only the shard for the
behavior being changed.

## Latest Change

The newest code change is `fb279717` (`feat: server post-generation output
trigger + editoutput (slice 4 / A2)`). It landed `runServerPostGeneration` on
the server-dispatch path: run-var pass, `runTrigger(..., 'output', ...)`, and
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
  post-generation derivation.
- Closed: command boundary, bootstrap projection + command-event invalidation,
  `.risu` import/export/bundle, asset routes + reference validation, backup/
  restore, provider secret masking, supported-provider server dispatch, and all
  A1/A2 chat-process blockers.
- Audit reproducibility is complete (21 rules, 45 tests), but several rules are
  shallow and four were empirically defeated by sincere refactors. See
  [`status/audit.md`](status/audit.md).

## Next Delta Target

Follow the work order in [`plan.md`](plan.md):

1. Run the audit; fix/triage if red.
2. Group-chat legacy removal.
3. Audit-rule hardening (A4R2, A4R7, fanout-svelte, EC2).
4. Documentation-only reconciliation when code/docs drift.
5. Event patching stays deferred until SSE reconnect/replay exists.

## Batching Policy

- One coherent batch; keep group-chat removal, audit-rule hardening,
  event-patching, and docs-only reconciliation separate.
- Write a compact scope: invariant, owner, timing, inputs, allowed mutations,
  persistence, errors, rollback, active-writer behavior, projection refresh, proof.
