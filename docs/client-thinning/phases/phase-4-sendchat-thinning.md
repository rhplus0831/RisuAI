# Phase 4: sendChat Thinning

Date: 2026-05-28

Status: active only for named prompt or post-generation branches with proof.

## Current Boundary

- Provider dispatch is server-routed in Fastify mode for supported provider
  shapes.
- `/api/v1/generate/chat` can assemble prompts and optionally dispatch the
  provider.
- Production `sendChat` still falls back to local prompt assembly unless
  `useServerPromptAssembly` is true.
- Default chat-screen submission still creates or replaces transcript rows in
  the browser before dispatching command-backed persistence.
- Server-backed sendChat still applies server message/scriptstate patches in
  the browser and persists final generation results through a browser command.
- Post-generation orchestration remains mixed.

## Valid Targets

- Make server prompt assembly the default for a documented supported subset.
- Remove one local prompt fallback branch after server proof exists.
- Move one post-generation behavior server-side when it affects persisted
  generation semantics or unlocks a named browser branch removal.
- Persist one server-detected chat-variable/scriptstate or generation-result
  mutation in `/generate/chat` instead of browser replay, with command/revision
  proof.
- Add focused proof that blocks a future removal.

## Non-Targets

- Do not combine prompt defaulting, provider expansion, and post-generation
  rewrites in one batch.
- Do not widen provider support without a named server route contract.
- Do not remove browser UI/display ownership.

## Actionable Slices

Land these as separate batches. Do not combine prompt defaulting, branch removal,
or post-generation migration work.

1. Prompt contract proof.
   - Objective: Name one supported prompt-assembly subset before changing
     defaults.
   - Scope: Add route/helper and browser fixture proof for that subset only;
     leave runtime defaults, provider support, fallback branches, and
     post-generation behavior unchanged.
   - Done: Proof names the provider/input shape and the protected local branch.
2. Prompt defaulting.
   - Objective: Make server prompt assembly the default for the proven subset.
   - Scope: Change only the defaulting decision for that subset; keep local
     prompt fallback and unsupported/provider guard branches explicit.
   - Done: Browser proof shows default chat submission uses server assembly, and
     unsupported shapes still take the documented path.
3. Local prompt branch removal.
   - Objective: Remove one named local prompt assembly fallback branch covered
     by server proof.
   - Scope: Delete only that browser branch; do not change prompt defaults,
     provider support, or post-generation behavior in the same batch.
   - Done: Search or audit proof shows the branch is gone, and fixture coverage
     exercises its former input.
4. Server patch persistence.
   - Objective: Persist one server-detected chat-variable or scriptstate
     mutation in `/generate/chat`.
   - Scope: Route the mutation through server command/revision handling while
     keeping browser display ownership and final result persistence unchanged.
   - Done: Route/helper proof asserts persisted command/revision effects, and
     browser proof consumes the projection instead of replaying the mutation.
5. Generation-result persistence.
   - Objective: Persist one final generation-result mutation from
     `/generate/chat` instead of browser command replay.
   - Scope: Move only the selected persisted result semantics; do not pair this
     with prompt defaulting, fallback removal, or provider expansion.
   - Done: Server proof covers the persisted result, and browser proof shows the
     matching client replay branch is removed or bypassed.
6. Post-generation behavior migration.
   - Objective: Move one post-generation behavior server-side only when it
     affects persisted generation semantics or unlocks a named browser branch
     removal.
   - Scope: Pick exactly one behavior after provider output; keep prompt
     assembly, provider support, and UI/display ownership unchanged.
   - Done: The batch names the removed/protected browser branch and includes
     route/helper plus browser fixture proof for the migrated behavior.

## Exit Criteria

- The batch names the exact branch being removed or protected.
- Server route/helper proof and browser fixture proof agree.
- Client-owned display behavior remains explicit.
