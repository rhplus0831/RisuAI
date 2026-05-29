# Sub-slice 3b-3: Lua `editprocess` hook

Date: 2026-05-29 (handover; not started)

| | |
| --- | --- |
| **Series** | [Lua server port](README.md), sub-slice **3 of 4** |
| **Depends on** | **sub-slice 1** (the VM) |
| **Goal** | Add the Lua `editprocess` hook to the history pass next to `processScript`. **Near-trivial: Lua `editprocess` is a browser no-op.** |

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

- [ ] Server runs Lua `editprocess` through the runtime and reproduces the browser
      no-op at parity.
- [ ] pluginV2 `editprocess` remains permanent `unsupported` (untouched; the
      `A4R-pluginv2` invariant still passes).
