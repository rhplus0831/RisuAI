# Slice 1: A1 Foundation — the prompt-assembly classifier

Date: 2026-05-29

| | |
| --- | --- |
| **Work-order item** | 1 (A1 foundation) |
| **Blocker** | A1 (prompt-assembly content parity) — the foundational primitive |
| **Depends on** | nothing; this is first |
| **Reference** | [`../../reference/prompt-assembly-classifier.md`](../../reference/prompt-assembly-classifier.md) |
| **Goal** | Build `resolveServerPromptAssembly` (`server`/`local`/`unsupported`) and replace the `useServerPromptAssembly` boolean gate so the pure-text-send subset is server-mandatory and out-of-subset sends hard-fail — never silently assemble locally. |
| **Status** | **DONE** in commit `4e8c4f37`. |

## Outcome

After this slice, in Fastify mode:

- A pure text send (single non-group character, server-routable provider, no
  asset/image-gen/Lua/plugin content) **must** assemble on the server.
  `assembleLocalSendChatPrompt` is **unreachable** for it.
- Any out-of-subset send returns `unsupported` and **hard-fails** with a
  user-facing reason — it does not fall through to local assembly.
- The silent `unavailable` → local fall-through hole is gone.
- `local` is reachable only when `!isFastifyServer` (dev/web/tests) or the
  default-off `useServerPromptAssembly` master gate is off.

This slice did **not** port any content class. It classified unsupported classes;
slices 3a/3b/3c each later graduate one to `server`.

## Historical Preconditions

The checklist below records the pre-land state and is retained for maintenance
context.

- [ ] `pnpm client-thinning:audit` is green (or its findings are triaged).
- [ ] The route-backed and preview sweeps are green:
      `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts`.
- [ ] `rg resolveServerPromptAssembly src/` returns nothing (confirm it really
      doesn't exist yet).

## Historical Step-by-step

### Orient (read, do not edit)

1. Read [`../../reference/prompt-assembly-classifier.md`](../../reference/prompt-assembly-classifier.md)
   end to end. It is the spec for this slice.
2. Study the precedent `resolveServerCompletionRoute`
   (`src/ts/process/request/serverCompletion.ts:538`) and its three-arm type
   (`:13-16`): `local` is bare, `server` carries the resolved provider,
   `unsupported` carries a `reason`. Note the **first line is
   `if (!isFastifyServer) return { type: 'local' }`** — the only `local` return.
3. Read the current gate + switch in `src/ts/process/index.svelte.ts:162-226`:
   the boolean gate (`:162`), the status switch (`:177-199`), and the
   `if (!assembledByServer)` local fall-through (`:202`) — the one call to
   `assembleLocalSendChatPrompt`.
4. Read the silent hole: `src/ts/process/serverBackedSendChat.ts:139-143`
   (`canUseServerAssembly` → `{ status: 'unavailable' }`) and confirm
   `index.svelte.ts` has **no** `case 'unavailable'` (so it falls through to
   local). This slice closes it.

### Implement — the classifier

5. **Create the classifier file**, mirroring the precedent:
   `src/ts/process/request/serverPromptAssembly.ts` (sibling to
   `serverCompletion.ts`, so its test sits next to `serverCompletion.test.ts`).
   Export the three-arm union:

   ```ts
   export type ServerPromptAssemblyRoute =
     | { type: 'local' }
     | { type: 'server' }
     | { type: 'unsupported'; reason: string }
   ```

   (`server` needs no payload — assembly does not pick a provider; dispatch does.)

6. **Define `resolveServerPromptAssembly(input)`** as a pure function. Decision
   order, copying the precedent's shape exactly:

   1. `if (!isFastifyServer) return { type: 'local' }` — the **only** `local`
      return. In Fastify mode the verdict is always `server` or `unsupported`.
   2. **Mode / user-message structural check** (subsumes the old
      `canUseServerAssembly`): derive the mode the way `serverChatMode`
      (`serverBackedSendChat.ts:84-95`) does. For `mode === 'send'`, require the
      last message to be a user-role string; if not → `unsupported`
      (with a clear reason). This replaces the silent `unavailable`.
   3. **Single non-group character** → else `unsupported`. Groups are already
      filtered upstream (`database.svelte.ts:110`) and `isGroupChat` is hardcoded
      `false`, but treat group-ness as an **explicit** `unsupported` signal per
      the flag's JSDoc (do not rely on the filter).
   4. **Server-routable provider** → reuse the provider half, do not re-derive
      it: call `resolveServerCompletionRoute` / `getServerCompletionProvider`
      (`serverCompletion.ts:538/578`). If the provider is not server-routable →
      `unsupported` (surface that route's reason).
   5. **Content-signal check** (the net-new hole). If the send carries **any** of
      the content classes below → `unsupported`. This is a coarse *presence*
      detector; each later content slice removes one class from this set.
   6. Otherwise → `{ type: 'server' }`.

7. **Write the content-signal detector** used in step 6.5. It returns true if the
   send carries any class the server assembler cannot yet reproduce. Detect from
   these fields (see [`../../reference/local-assembler-content-classes.md`](../../reference/local-assembler-content-classes.md)
   for the exact origins):

   | Class | Detect from | Removed by |
   | --- | --- | --- |
   | Multimodal / asset | non-empty `message[].multimodals`, or inlay/asset markers (`{{inlay…}}`, `{{inlayed…}}`, `{{inlayeddata…}}`, `{{asset_prompt::…}}`, `{{assetprompt::…}}`) in any message `.data` | slice 3a |
   | Image-gen instruction | `currentChar.inlayViewScreen` truthy (+ `viewScreen`/`newGenData`) | slice 3c |
   | Lua / plugin-V2 / triggers | `currentChar.triggerscript` containing `triggerlua` effects (or module triggers); any non-empty `pluginV2` edit set (`editRequest`/`editprocess`/`editinput`/…) | slice 3b |

   Keep each class behind its **own** named predicate so a later slice flips
   exactly one line. Keep the detector conservative: on doubt, return
   `unsupported`, never `server`.

### Implement — replace the gate

8. In `src/ts/process/index.svelte.ts`, **replace the boolean gate** at `:162`
   with a switch on `resolveServerPromptAssembly(...)`:
   - `server` → run the existing `assembleServerBackedSendChat` path and its
     status switch (`:163-199`), unchanged.
   - `unsupported` → **hard fail**: `throwError(route.reason)` and `return false`
     (the terminal-error shape, mirroring `request.ts:528-531`'s
     `{ type: 'fail', noRetry: true }`). Do **not** fall through.
   - `local` → run `assembleLocalSendChatPrompt` (`:202-226`). Because `local`
     only arises when `!isFastifyServer`, this branch is dead in production
     Fastify mode — same as the precedent.

9. **Remove the silent fall-through.** The `if (!assembledByServer)` guard at
   `:202` must no longer be reachable as a *fallback after a server attempt*; it
   becomes the `local` arm. Delete the `{ status: 'unavailable' }` return from
   `serverBackedSendChat.ts:143` and its declaration at `:46` — the
   mode/string-user-message decision now lives in the classifier (step 6.2), so
   `assembleServerBackedSendChat` is only ever called once the verdict is
   `server`.

10. Feed the classifier the same inputs the gate has at `:162`: `isFastifyServer`,
    the mode args (`preview`/`previewPrompt`/`continue`/`regenerateMessageId`),
    `currentChat` (last message + markers + `multimodals`), `currentChar`
    (group-ness, `triggerscript`, `inlayViewScreen`/`newGenData`), and whatever
    `resolveServerCompletionRoute` needs for the provider half.

### Prove

11. **Classifier unit test** — new
    `src/ts/process/request/tests/serverPromptAssembly.test.ts`, mirroring the
    layout of `serverCompletion.test.ts:145-202`: a per-case table asserting the
    three-way verdict (`!isFastifyServer` → `local`; in-subset → `server`; each
    out-of-subset signal → `unsupported` with a non-empty reason). One case per
    content class proving it currently routes `unsupported` (the later slices
    flip these).
12. **Negative reachability test** — that for the supported subset in Fastify
    mode the local assembler is not entered. The test-side proxy (per
    [`../../reference/proof-points.md`](../../reference/proof-points.md)) is a
    throwing fetch stub + asserting the server path ran;
    the "function is statically unreachable" guarantee belongs in the **audit**
    (step 14), not vitest.
13. **Keep the existing sweeps green** unchanged:
    `sendChat.fixtures.serverBacked.test.ts` (Describe B), `sendChat.serverPreview.test.ts`,
    `serverChat.test.ts`. Flipping the gate must not move any golden snapshot.
14. **Audit** — add `resolveServerPromptAssembly`'s presence + the
    `if (!isFastifyServer) return { type: 'local' }` needle to the audit alongside
    EC1 (`checkProviderOwnership`, `util/client-thinning-audit.ts:1234`), either
    as new needles in EC1 or a sibling check. Add a failing+bypass fixture pair
    under `util/client-thinning-audit-fixtures/` per the existing convention.

### Land

15. Run the [shared verification](README.md#shared-verification-run-before-and-after-every-slice).
16. Update docs: in [`../../reference/prompt-assembly-classifier.md`](../../reference/prompt-assembly-classifier.md)
    and [`../../status/sendchat-thinning.md`](../../status/sendchat-thinning.md),
    record that the classifier now exists and the subset is server-mandatory.
    Note in [`../../reference/server-assembler-parity.md`](../../reference/server-assembler-parity.md)
    that the three GAP rows are now *classified* `unsupported` (not silently
    mis-assembled).

## Decision points

- **Where the classifier lives.** Recommended: a new
  `serverPromptAssembly.ts` beside `serverCompletion.ts` (symmetry +
  co-located test). Alternative: fold into `serverBackedSendChat.ts`. The
  reference assumes the former.
- **Do not delete `useServerPromptAssembly`.** Its JSDoc
  (`database.svelte.ts:1354-1368`) says removing the flag is the *end* of the
  whole prompt-assembly thinning sub-family, not this slice. This slice replaces
  the *gate's decision logic*; the flag stays until the local fallback is gone
  for all classes (after 3a/3b/3c). The classifier may still read the flag as the
  master enable while content classes remain `unsupported`.

## Scope guard

Do not port any content class here (that is 3a/3b/3c). Do not touch
post-generation persistence (slice 2/4). Do not add a server group model. This
slice is the classifier + gate replacement + the proof that the subset can no
longer reach local.

## When this slice is done

- [x] `resolveServerPromptAssembly` exists, is pure, returns `local` only when
      `!isFastifyServer` or the master flag is off, and is unit-tested like
      `serverCompletion`.
- [x] The `index.svelte.ts` boolean gate is replaced; `unsupported` hard-fails;
      the `unavailable` status is deleted.
- [x] A negative test shows the local assembler is not entered for the subset; the
      audit pins the classifier's presence.
- [x] All prior sweeps are still green with no snapshot drift.
