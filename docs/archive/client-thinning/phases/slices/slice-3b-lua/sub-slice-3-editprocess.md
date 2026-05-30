# Sub-slice 3b-3: Lua `editprocess` hook

Date: 2026-05-29 (**landed**)

| | |
| --- | --- |
| **Series** | [Lua server port](README.md), sub-slice **3 of 4** |
| **Depends on** | **sub-slice 1** (the VM) |
| **Goal** | Add the Lua `editprocess` hook to the history pass next to `processScript`. **Near-trivial: Lua `editprocess` is a browser no-op.** |
| **Status** | **Done.** The `editProcess` seam is wired at both history `processScript('editprocess')` call sites (`history.ts`) and fed a VM-backed `runLuaEditTrigger(char, 'editprocess', …)` hook by the assembler (`assemble.ts::fillHistoryAndBias`, via the shared `buildLuaEditTriggerContext`). The hook is identity at parity because the runtime early-returns for `editprocess`; latest aggregate verification is recorded in `coverage/latest-verification.md`. |

## The honest framing

`runLuaEditTrigger` **early-returns for `editprocess`** in the browser
(`scriptings.ts:1431-1432`) — i.e. Lua `editprocess` does *nothing*. The pluginV2
`editprocess` arm (which *does* run in the browser) is **permanent `unsupported`**
(already landed; see [README](README.md#decisions-already-made-do-not-relitigate)).
So this sub-slice's real content is small: make the server faithfully reproduce the
no-op and prove it, so a future change can't silently diverge.

## Step-by-step

1. In the history pass where `processScript(...,'editprocess',...)` runs
   (`scripts.ts:315`, applied `history.ts:292-300,452-457`), add the Lua hook
   alongside the regex processor: `runLuaEditTrigger(char,'editprocess',content,ctx)`.
   Because the runtime mirrors the browser early-return, this is identity — but wire
   it through the runtime (not a hardcoded identity) so it stays faithful if the
   browser's behavior ever changes.
2. No classifier change beyond sub-slice 2's flip — a char with only an editprocess
   Lua handler is already covered by the Lua-arm flip.

## Prove

- `generation.chat.test.ts`: a char with a Lua `editprocess` handler assembles
  **identically** to the same char without it (proves the no-op parity).
- Shared verification.

## When done

- [x] Server runs Lua `editprocess` through the runtime and reproduces the browser
      no-op at parity. (`history.ts` `editProcess` seam at both `processScript`
      sites; `assemble.ts::fillHistoryAndBias` supplies the VM-backed hook. Parity
      proven by `generation.chat.test.ts` "runs Lua editprocess through the runtime
      as a no-op at parity".)
- [x] pluginV2 `editprocess` remains permanent `unsupported` (untouched; the
      `A4R-pluginv2` invariant still passes — `client-thinning:audit` green).

## What landed

- **`history.ts`** — new `EditProcessHook` type + optional `editProcess` param on
  `buildHistoryWindow` (default identity = the browser no-op). `formatHistoryMessage`
  is now `async`; both the first-message and per-message `processScript('editprocess')`
  sites run the hook between the `expandVariables` pre-pass and the regex processor,
  mirroring `processScriptFull`'s leading `runLuaEditTrigger`. The first message passes
  `index = -1` (the SPA's default `chatID`).
- **`assemble.ts`** — extracted `buildLuaEditTriggerContext(state)` (shared by the
  `editRequest` and `editprocess` hooks); `fillHistoryAndBias` builds the VM-backed
  `editProcess = (content, index) => runLuaEditTrigger(char, 'editprocess', content,
  { index }, editCtx)` and threads it into `buildHistoryWindow`. No `varChanged` fold —
  the no-op never writes vars.
- **`scripts.ts`** — corrected the stale "runLuaEditTrigger (browser-only)" header note.
- **Tests** — `generation.chat.test.ts` no-op parity test (baseline vs `triggerlua`
  char that defines an `editprocess` global → byte-identical rows, marker absent);
  `serverPromptAssembly.test.ts` editprocess-only Lua char → `server`.
