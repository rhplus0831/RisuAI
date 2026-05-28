# Client Thinning Note

Date: 2026-05-29

Short handoff for the Fastify-only client-thinning workstream. Start with
[`status.md`](status.md), [`plan.md`](plan.md), and only the shard for the
behavior being changed.

## Latest Change

Direction was corrected on 2026-05-29: these docs were rewritten from scratch
around the **chat-process ownership blocker classification** (see
[`plan.md`](plan.md)). Two concrete changes landed alongside the rewrite:

- `useServerGeneration` (a dead/legacy flag) was removed (commit `refactor:
  remove dead useServerGeneration flag and annotate runtime gates`). The two
  remaining gates — `isFastifyServer` and `useServerPromptAssembly` — were kept
  and annotated in-code as NOT deprecated.
- **Group chat** was reclassified from "unsupported under server assembly" to
  **fully legacy**: no-port AND to be removed from the client. The code removal is
  a separate task — see
  [`unsupported-and-client-owned.md`](unsupported-and-client-owned.md).

## Latest Verification

- Command: `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts src/ts/process/request/tests/serverCompletion.test.ts`
- Result: Passed (163 tests).
- Command: `pnpm client-thinning:audit`
- Result: Passed (`Client-thinning audit passed.`).

## Current State

- Default Fastify chat flow: browser assembles the prompt
  (`useServerPromptAssembly` off), server makes the LLM call (platform-gated),
  browser orchestrates post-gen, persistence via browser-issued commands. The
  generation routes are stateless w.r.t. the chat blob.
- Closed: command boundary, bootstrap projection + command-event invalidation,
  `.risu` import/export/bundle, asset routes + reference validation, backup/
  restore, provider secret masking, supported-provider server dispatch.
- Audit reproducibility is complete (20 rules, 41 tests), but ~12/20 rules are
  shallow and four were empirically defeated by sincere refactors. See
  [`status/audit.md`](status/audit.md).

## Next Delta Target

Follow the work order in [`plan.md`](plan.md):

1. Run the audit; fix/triage if red.
2. A1 foundation: `resolveServerPromptAssembly` classifier + make the supported
   text-send subset server-mandatory.
3. C-A1: move assembly-time scriptstate persistence into `/generate/chat`.
4. Port A1 content classes one at a time.
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
