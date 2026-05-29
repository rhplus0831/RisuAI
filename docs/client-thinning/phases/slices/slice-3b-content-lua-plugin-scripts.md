# Slice 3b: A1 content — Lua / plugin-V2 + input scripts

Date: 2026-05-29

| | |
| --- | --- |
| **Work-order item** | 3 (A1 content classes), batch **b** |
| **Blocker** | A1 (content parity) — classes 4, 5, 6, 7 |
| **Depends on** | **slice 1** (classifier); the largest A1 content batch |
| **Reference** | [`../../reference/server-assembler-parity.md`](../../reference/server-assembler-parity.md) §`templates.ts`/§`triggers.ts` + [`../../reference/local-assembler-content-classes.md`](../../reference/local-assembler-content-classes.md) classes 4–7 |
| **Goal** | Bring server prompt assembly to parity for Lua `editRequest`, Lua/plugin-V2 `editprocess`, and the input-trigger/`editinput` scripts — or keep them explicitly `unsupported`. The server runs **regex scripts only** today. |

## The honest framing first

The server assembler is **regex-only**. Lua `editRequest` runs identity
(`templates.ts:683`), Lua `editprocess` is a no-op, and pluginV2 hooks are
unported. Reaching parity means **standing up a server-side scripting VM**
(`wasmoon` Lua or a Pyodide worker) that runs arbitrary user code — a large
sub-project, not a one-sitting change. Slice 1 already classifies all of these
`unsupported`, so the *correctness* hole is already closed (no silent
mis-assembly). This slice is therefore a **decision gate**, then either a port or
a documented permanent `unsupported`.

## Outcome (port path)

- A server scripting runtime runs the Lua/Python `editRequest` hook, the
  Lua/pluginV2 `editprocess` hooks, and the submit-time input-trigger/`editinput`
  scripts, with parity to the browser.
- The classifier's **Lua/plugin/trigger** detector (slice 1, step 7) flips from
  `→ unsupported` to `→ server`.

## Outcome (keep-unsupported path)

- The disposition is recorded as **permanent** `unsupported` in
  [`../../unsupported-and-client-owned.md`](../../unsupported-and-client-owned.md)
  with the rationale (no server code-execution sandbox). The classifier already
  enforces it; no further code. Note: "server-side plugin code execution" is on
  the historical **no-port list** in [`../../plan.md`](../../plan.md) — so the
  pluginV2 half in particular leans toward this path.

## Preconditions

- [ ] Slice 1 landed; Lua/plugin sends currently route `unsupported`.
- [ ] You have read [`../../plan.md`](../../plan.md) §"Legacy / removed" — the
      no-port list explicitly includes server-side plugin code execution.

## Step-by-step

### Decide (do this before any code)

1. Read both reference docs' Lua/plugin sections in full
   ([server side](../../reference/server-assembler-parity.md) §`templates.ts`,
   §`scripts.ts`, §`triggers.ts`; [browser side](../../reference/local-assembler-content-classes.md)
   classes 4–7).
2. **Make the gate decision per sub-class** — they are not all the same:

   | Sub-class | Browser engine | Realistic disposition |
   | --- | --- | --- |
   | Lua/Python `editRequest` (4) | `runLuaEditTrigger` → `wasmoon`/Pyodide (`scriptings.ts:1415`) | port needs a server Lua/Pyodide VM |
   | Lua `editprocess` (5) | no-op in browser (`scriptings.ts:1431-1432`) | trivial — already effectively identity |
   | pluginV2 `editprocess`/`editRequest` (5) | JS `EditFunction`s in the browser plugin runtime | leans **permanent unsupported** (no-port list) |
   | input-trigger / `editinput` at submit (6) | `runTrigger('input')` + `processScript('editinput')` (`DefaultChatScreen.svelte:232,240`) | port needs the VM + a submit-time server hook |

   If any sub-class is permanent `unsupported`, the **whole Lua/plugin detector
   stays** (a send with that sub-class still hard-fails) — but you can still port
   the others to shrink the `unsupported` surface.

### Implement — port path (only the sub-classes you chose to port)

3. **Stand up the server scripting runtime.** This is the gating dependency for
   classes 4 and 6. Decide `wasmoon` vs Pyodide-worker; provide the same globals
   the browser engine exposes (`callListenMain`, `listenEdit`, the
   `triggerscript`/module-trigger iteration). This is large enough that, once it
   exists, **classes 4 and 6 should be separate review batches** under it.
4. **`editRequest` (class 4):** wire the real hook into the request-edit seam that
   currently defaults to identity — `templates.ts:683` (`editRequest = rows => rows`),
   applied at `:725-730`; `renderAndBudget` calls `renderFinalPrompt` without an
   `editRequest` key (`assemble.ts:1058-1068`). Supply the VM-backed `editRequest`
   so it runs over `formated` (and `promptInfo`). Remember the **two-stage** note
   in the reference: the dispatch layer also edits rows (`replacerbeforeRequest`,
   the `'request'` trigger, `replacerafterRequest`) — a faithful port accounts for
   both stages.
5. **`editprocess` (class 5):** add the Lua/pluginV2 hooks next to `processScript`
   in the history pass (`scripts.ts:50-56` defer them; applied at
   `history.ts:292-300,452-457`). Lua `editprocess` is a browser no-op, so the Lua
   side is near-free; the pluginV2 side only ports if you chose to (step 2).
6. **input-trigger / `editinput` (class 6):** these run at **submit**, before
   assembly (`DefaultChatScreen.svelte:229-244`) — they rewrite the transcript
   before the message is persisted. Porting means a server hook *before* assembly
   that runs `runTrigger('input')` + `processScript('editinput')`. Do **not**
   conflate the two B1 input-plumbing branches in the same handler (slash text,
   file-inlay insertion, `DefaultChatScreen.svelte:203-216`) — those stay browser.

### Implement — flip the classifier

7. Once a sub-class reaches parity, flip *its* slice of the Lua/plugin predicate
   in `resolveServerPromptAssembly` from `unsupported` to allowed. If any
   sub-class stays permanent `unsupported`, keep that arm; only the ported arms
   flip.

### Prove

8. **Server parity** for each ported hook: `generation.chat.test.ts` cases that
   assert the server-assembled prompt reflects the Lua/pluginV2 edit (vs the
   regex-only baseline).
9. **Parity fixture** in `sendChat.fixtures.serverBacked.test.ts` Describe B for a
   char with a `triggerscript`/`editinput` script; assert server == local golden.
10. **Classifier test** (slice 1): the ported sub-class now asserts `server`; any
    permanent-unsupported sub-class keeps asserting `unsupported`.
11. If a sub-class is permanent `unsupported`, add an **audit** assertion that no
    Lua/pluginV2 execution path exists server-side (an A4-style invariant), so a
    future refactor can't silently "port" it into an unsafe sandbox.

### Land

12. Run the [shared verification](README.md#shared-verification-run-before-and-after-every-slice).
13. Update docs: flip the relevant rows in
    [`../../reference/server-assembler-parity.md`](../../reference/server-assembler-parity.md)
    (`Lua/pluginV2 editRequest`, `editprocess hooks`); update classes 4–7 in
    [`../../reference/local-assembler-content-classes.md`](../../reference/local-assembler-content-classes.md);
    record permanent-unsupported sub-classes in
    [`../../unsupported-and-client-owned.md`](../../unsupported-and-client-owned.md).

## Scope guard

This is the batch most likely to overflow "one blocker item per review." If you
take the port path, **split by sub-class** (the VM, then `editRequest`, then
`editprocess`, then input-trigger/`editinput`) — do not land the VM and all four
hooks in one review. Do not pull A2's `'output'` trigger / `editoutput` in here
(slice 4) even though they share the machinery. Do not touch multimodal (3a) or
image-gen (3c).

## When this slice is done

- [ ] Per sub-class, a recorded decision: ported (with parity proof) or permanent
      `unsupported` (with a doc entry + an audit invariant).
- [ ] For ported sub-classes: server runs the hook, the classifier routes them
      `server`, and a parity fixture is green.
- [ ] No silent local fallback for any Lua/plugin/trigger send.
