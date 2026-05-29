# Sub-slice 3b-2: Lua `editRequest` hook + classifier flip

Date: 2026-05-29 (landed)

| | |
| --- | --- |
| **Series** | [Lua server port](README.md), sub-slice **2 of 4** |
| **Depends on** | **sub-slice 1** (the VM) |
| **Goal** | Wire the VM-backed Lua `editRequest` hook into the assembler's request-edit seam and flip the classifier's Lua arm to `server` for the editRequest case. The dominant Lua case. |
| **Status** | **DONE.** Hook wired in `assemble.ts::renderAndBudget` (via `buildLuaEditRequest`); classifier Lua arm flipped to `server` except interactive-API scripts (`serverPromptAssembly.ts::luaUsesInteractiveApi`). |

## The seam already exists (unused)

`renderFinalPrompt` already accepts an injectable `editRequest`
(`templates.ts:635`, applied `:725-730` over `formated` and the `promptInfo`
capture). It defaults to identity and is **never supplied**: `renderAndBudget`
calls `renderFinalPrompt` without the key at **`assemble.ts:1082`**. The browser
runs it at `renderFinalPrompt.ts:384` via `runLuaEditTrigger(char,'editRequest',formated)`.

## Step-by-step

1. In `renderAndBudget` (`assemble.ts:1082`), supply
   `editRequest: (rows) => runLuaEditTrigger(char, 'editRequest', rows, ctx)` from the
   sub-slice-1 runtime, threading the assembly's char + var-engine context. Apply it
   over `formated` **and** the `promptInfo` capture (the browser does both).
2. Ensure Lua `setChatVar`/`setState` writes during the hook land in the scriptstate
   delta (`buildChatVarMutations` / `persistAssemblyMutations`) — see
   [README §Integration](README.md#integration-points-in-the-server-assembler). Add a
   test that an `editRequest` that calls `setState` bumps the persisted revision.
3. **Flip the classifier.** The old Lua arm (`sendHasLuaContent`,
   `serverPromptAssembly.ts`) could not tell statically which mode a script hooks
   (handlers register at runtime). Decide the flip granularity:
   - simplest defensible cut: flip the Lua arm to `server` **except** when the Lua
     source references an interactive API (`alertInput`/`alertSelect`/`alertConfirm`)
     → keep those `unsupported` (the finer arm). Add a `luaUsesInteractiveApi(char)`
     predicate.
   - update `request/tests/serverPromptAssembly.test.ts`: a `triggerlua` char now
     routes `server`; an interactive-API char stays `unsupported`.
4. Replace the server `triggerlua` no-op fall-through if it interferes
   (`triggers.ts:264-280,817-834`) — but `editRequest` runs via the template seam,
   not `runTrigger`, so this may be untouched here. Confirm.

## Prove (as landed)

- `generation.chat.test.ts` (server suite, node env):
  - a char whose Lua `editRequest` rewrites every row → the server-assembled prompt
    reflects it (`'MAIN' → 'MAIN [LUA]'`, in-place, vs the regex-only baseline);
  - an `editRequest` that calls `setState` → the chat-var delta carries `$__turns`
    and the route bumps the revision (persisted via the same scriptstate write);
  - **byte-parity vs the local golden**: the real server VM reproduces the
    `editrequest-trigger` golden's marker row (`expected/editrequest-trigger.json`)
    exactly.
- Classifier (`request/tests/serverPromptAssembly.test.ts`): a non-interactive
  `triggerlua` char → `server`; an `alertInput`/`alertSelect` char → `unsupported`;
  a non-interactive Lua char no longer shadows a pluginV2 hard-fail.
- Shared verification green: `client-thinning:audit`, `api:test`, `test`, `check`.

**Why the golden-parity proof is in the server suite, not
`sendChat.fixtures.serverBacked.test.ts`:** the route-backed harness boots the real
Fastify server *in-process*, and the server Lua VM uses `wasmoon`, whose WASM init
calls `createRequire(import.meta.url)` — which throws under that browser suite's
jsdom environment (`http://localhost:3000/...` is not a file URL; this is the same
reason `__fixtures__/mocks/scriptings.ts` exists). So the real VM can only run in
the node-env server suite. A note records this in the serverBacked file.

## When done

- [x] Server runs the Lua `editRequest` hook at byte parity with the browser.
- [x] Classifier routes editRequest Lua → `server`; interactive-API Lua → `unsupported`.
- [x] Lua var writes during the hook persist via the scriptstate delta.
- [x] Parity proof green (in the server suite — see the note above).

## Notes on the landed cut

- The classifier cannot tell statically which mode a script hooks, so the flip is
  the whole Lua arm → `server` *minus* the interactive-API arm (the "simplest
  defensible cut" above). At the time, a non-interactive Lua char that only
  hooked `editprocess`/`editinput` could route `server` ahead of those execution
  seams; sub-slices 3/4 have now landed and resolved that caveat.
- `triggers.ts` was untouched in sub-slice 2. `editRequest` runs via the template seam
  (`renderFinalPrompt`), not `runTrigger`; the start-trigger run still selects a
  `triggerlua` trigger (`matchesTrigger`) but no-ops it in the effect switch — the
  server parity tests cover a `type: 'request'` triggerlua char and confirm no
  interference. Sub-slice 4 later added the input-trigger `triggerlua` VM seam.
