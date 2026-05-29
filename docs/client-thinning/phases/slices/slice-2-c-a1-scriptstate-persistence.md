# Slice 2: C-A1 — server-side scriptstate persistence

Date: 2026-05-29

| | |
| --- | --- |
| **Work-order item** | 2 (C-A1) |
| **Blocker** | C-A1 (post-gen persistence; **no parity blocker**) |
| **Depends on** | nothing — independent of slice 1; the plan's smallest real batch |
| **Reference** | [`../../reference/post-generation-and-persistence.md`](../../reference/post-generation-and-persistence.md) |
| **Goal** | Move the **assembly-time** scriptstate delta persistence into `/generate/chat` and retire the browser's command replay. The server already computes the delta; this stops the round-trip where the browser POSTs it back. |
| **Status** | **DONE** in commit `654db21a`. |

## Outcome

- `/api/v1/generate/chat` persists `result.mutations.chatVarMutations` itself,
  bumps the chat revision once, emits the command event, and returns the new
  revision over SSE.
- The browser stops re-POSTing the same delta via `dispatchPatchChatScriptstate`;
  it keeps `applyServerMessagePatch` (projection-only) and reconciles its cached
  revision to the one the route returns.
- A non-active-writer `/chat` still does not persist (the route is already behind
  the active-writer guard — this slice must not weaken that).

This is **only** the assembly-time delta (`'start'` trigger + run-var pass). The
post-gen delta (`'output'` trigger + `editoutput`) is A2 / slice 4 — do not
conflate them.

## Preconditions

- [ ] `pnpm api:test` green (esp. `generation.chat.test.ts`).
- [ ] `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts` green.
- [ ] You can articulate **the two scriptstate deltas** (assembly-time vs post-gen)
      and that this slice touches only the first.

## Historical Step-by-step

The checklist below records the pre-C-A1 route shape and implementation path.
Current behavior is summarized in the Outcome and checked items.

### Orient

1. Read [`../../reference/post-generation-and-persistence.md`](../../reference/post-generation-and-persistence.md)
   §"The one distinction that matters", §"C-A1 — the persistence bridge", and
   §"Active-writer gating".
2. Trace the **exact current round-trip** (reference §"The exact current
   round-trip"): server mutates its clone's `scriptstate` during assembly →
   `buildChatVarMutations` (`assemble.ts:596`) diffs it → route emits
   `message_patch` (`generationChat.ts:281-283`) → browser applies it to the
   projection **and** re-POSTs it as a scriptstate command
   (`serverBackedSendChat.ts:118`) → server re-applies it to the chat it just
   mutated.
3. Confirm the pre-C-A1 route was stateless: its only repository import was
   read-only (`generationChat.ts:8`, `loadPersisted`); no write/`bumpRevision`
   existed in the file. This slice added the **first** write path to it.
4. Read how the command route persists the same delta —
   `applyJsonCommandMutation` (`server/fastify/src/commands/mutations.ts`): it
   checks revision, writes JSON, bumps revision once, emits one event, rolls back
   on failure. **Reuse this**; do not hand-roll a writer.

### Implement — server persists

5. In `server/fastify/src/routes/generationChat.ts`, after `assemblePrompt`
   returns (`:265`) and `result.mutations` is present (`:281`), **persist
   `result.mutations.chatVarMutations`** through `applyJsonCommandMutation`
   (the same path the scriptstate command uses, `commands.ts:2866-2911`:
   `Object.assign(chat.scriptstate, patch)` + delete-keys). This must:
   - apply only the chat-var mutations (not message mutations, which remain
     projection patches),
   - bump the revision exactly once and emit exactly one event (the existing
     mutation machinery already enforces "bump once / emit once / rollback on
     failure" — lean on it),
   - run only on real persisting modes; the preview/preview-prompt path
     (`:413`) stays read-only.
6. **Return the new revision over SSE.** The route returns *no* revision today.
   Add it to the success frame sequence (extend the `info` frame, or add a small
   dedicated frame) so the browser can reconcile. Keep emitting `message_patch`
   for the projection — the browser still needs the delta to update its local
   view without a refresh.
7. **Active-writer:** confirm `/api/v1/generate/chat` is in `isServerOwnedMutation`
   (`server/fastify/src/activeWriter.ts:58`) and behind `registerActiveWriterGuard`.
   It is — so a non-active-writer request 423s *before* the new write. Do not add
   a second guard; just make sure the write sits **after** the guard in the
   request lifecycle (it does, as a `preHandler`).

### Implement — browser stops replaying

8. In `src/ts/process/serverBackedSendChat.ts`, **drop the re-POST** at `:118`
   (`dispatchPatchChatScriptstate(...)`) inside `applyServerMessagePatches`
   (`:97-123`). Keep `applyServerMessagePatch` (the projection write) — only the
   command replay leaves the hot path. The snapshot/`previous` rollback bookkeeping
   that existed solely to support the re-POST can go with it.
9. **Reconcile the revision** the route now returns (step 6): update the cached
   revision the command layer reads (`runChatCommand`/`runServerCommand` revision
   source) so the next browser command uses the bumped `baseRevision` instead of
   a stale one. Without this, the next command POST will revision-conflict.
10. Leave `dispatchPersistGenerationResult` (`serverBackedSendChat.ts:284`,
    invoked at `index.svelte.ts:351`) **as-is** — persisting the final assistant
    message is a separate write (B2), not part of C-A1.

### Prove

11. **Flip the pre-C-A1 statelessness assertion.** `generation.chat.test.ts:436-474`
    currently asserts that a `setvar` start trigger emits
    `chatVarMutations: [{ key:'$score', before:null, after:'9' }]` yet bootstrap
    afterwards shows `revision: 1` / `scriptstate: undefined`. Change it to expect
    **persistence**: bootstrap shows the bumped revision and the written
    scriptstate. (Preview at `:548-579` must stay read-only — assert that too.)
12. **Zero outbound scriptstate POSTs.** Extend
    `sendChat.fixtures.serverBacked.test.ts` Describe B (the route-backed harness
    already proxies `/api/v1/commands/*` and records calls): for an assembly-time
    var write, assert **zero** `PATCH …/chats/:id/scriptstate` POSTs. See
    [`../../reference/proof-points.md`](../../reference/proof-points.md) §Describe B.
13. **Non-active-writer does not persist.** Add an assertion that a `/chat`
    request without the current writer session returns `423 active_writer_stale`
    and the chat is unchanged.
14. **Revision reconciliation.** Assert the browser's cached revision advances to
    the route-returned revision (so a subsequent command does not conflict).

### Land

15. Run the [shared verification](README.md#shared-verification-run-before-and-after-every-slice).
16. Update docs: flip the old "Chat-blob persistence … GAP by design — stateless"
    framing in [`../../reference/server-assembler-parity.md`](../../reference/server-assembler-parity.md)
    and the C-A1 rows in
    [`../../reference/post-generation-and-persistence.md`](../../reference/post-generation-and-persistence.md)
    and [`../../status/sendchat-thinning.md`](../../status/sendchat-thinning.md).

## Decision points

- **How the revision comes back.** Extending the existing `info` frame is the
  smallest change; a dedicated frame is cleaner if other consumers shouldn't see
  it. Either way the SSE taxonomy change must be reflected in
  `prompt/sseEvents.ts` and the client SSE consumer (`request/serverChat.ts`).
- **Keep the command route.** The scriptstate command
  (`PATCH …/chats/:id/scriptstate`) stays for slash/plugin/manual writes — it just
  leaves the generation hot path. Do not delete it.

## Scope guard

Only the assembly-time delta. No `'output'` trigger, no `editoutput` (that is
slice 4). Do not change the final-message persistence path. Do not touch the
classifier (slice 1).

## When this slice is done

- [x] The route persists chat-var mutations through `applyJsonCommandMutation`,
      bumps revision once, emits one event, returns the new revision.
      (`persistAssemblyChatVars` in `generationChat.ts`; revision on the `info` frame.)
- [x] The browser no longer re-POSTs the delta; projection apply stays; revision
      reconciles. (`applyServerMessagePatches` trimmed; `reconcileServerCommandRevision`
      → `setCachedServerCommandRevision` in `request/serverChat.ts`.)
- [x] `generation.chat.test.ts` persistence assertion is flipped to expect
      persistence; preview stays read-only.
- [x] Zero outbound `…/scriptstate` POSTs for an assembly-time var write; a
      non-active-writer `/chat` 423s before persisting.
      (`sendChat.fixtures.serverBacked.test.ts` Describe B + `generation.chat.test.ts`.)
