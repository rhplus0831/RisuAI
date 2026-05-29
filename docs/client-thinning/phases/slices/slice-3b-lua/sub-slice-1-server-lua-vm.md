# Sub-slice 3b-1: Server Lua VM (the runtime)

Date: 2026-05-29 (handover; not started)

| | |
| --- | --- |
| **Series** | [Lua server port](README.md), sub-slice **1 of 4** |
| **Blocker** | A1 (content) — the gating dependency for sub-slices 2/3/4 |
| **Depends on** | slice 1 (classifier), slice 3b pluginV2 split (landed) |
| **Security model** | **single-user self-host** (operator decision; see [README §Security](README.md#security-design-single-user-self-host)) |
| **Goal** | Stand up a server-side `wasmoon` Lua runtime that mirrors `runScripted` + `runLuaEditTrigger`, with the self-host security gate and the host-fn surface. **No assembler hooks, no classifier flip** — runtime + tests only. |

## Scope guard

This sub-slice lands **only the runtime**. Do not wire `editRequest`/`editprocess`/
`editinput` (those are sub-slices 2/3/4) and do not flip the classifier — the Lua
arm stays `unsupported` after this lands. The runtime is provable on its own
(unit tests that run Lua and assert host-fn behavior + security limits).

## Outcome

- A new `server/fastify/src/prompt/luaRuntime.ts` (name your call) exporting a
  server `runLuaEditTrigger(char, mode, content, meta, ctx)` and the lower-level
  `runScripted`-equivalent, byte-faithful to the browser for the **pure** host-fn
  subset, with privileged/browser host fns gated or no-op'd per the disposition
  table ([README](README.md#host-function-disposition-single-user-self-host)).
- The self-host security gate: SSRF-guarded `request()`, deferred (error-returning)
  `LLM()`/`axLLM()`, an enforced execution/loop limit, capped `sleep`, and
  interactive APIs that fail explicitly.
- Unit tests proving: a pure Lua `editRequest` handler transforms rows correctly;
  `request()` rejects private/loopback/metadata IPs + over-limit calls; a runaway
  script is interrupted; interactive APIs fail explicitly.

## Step-by-step

### Decide (before code)

1. Read **`src/ts/process/scriptings.ts`** in full (the engine map is in
   [README §The browser engine](README.md#the-browser-engine-you-are-porting)).
2. **Resolve the exec-limit mechanism** (README open question 1): probe whether the
   installed `wasmoon` exposes a way to set a Lua instruction-count hook
   (`lua_sethook`); if not, plan `worker_threads` isolation with `terminate()` on a
   wall-clock timeout. Write down the choice and why.
3. **Decide `json.lua` delivery** (README open question 2): bundle a copy or read
   `public/lua/json.lua` at boot. Make it deterministic under `pnpm api:test`.
4. **Decide engine lifetime**: prefer **per-send isolation** (a fresh engine per run)
   over the browser's per-mode reuse, so chat A's globals never leak into chat B
   (README open question 3).

### Implement — the runtime shell

5. Create the factory/engine bootstrap mirroring `makeLuaFactory`/`ensureLuaFactory`
   (`scriptings.ts:1191-1229`): a `LuaFactory`, `mountFile('json.lua', <bytes>)`,
   `createEngine({ injectObjects: true })`.
6. Port `luaCodeWrapper` (`scriptings.ts:1262`) verbatim (it is pure Lua — `listenEdit`,
   `callListenMain`, `getState`/`setState`, the JSON wrappers). It is the contract
   the edit-hook dispatch depends on; keep it identical so `callListenMain` round-trips.
7. Port the `runScripted` shell: declare host fns (next step), `engine.doString(wrapper)`,
   then dispatch by `mode`. For the edit modes call
   `callListenMain(mode, accessKey, JSON.stringify(data), JSON.stringify(meta))` and
   `JSON.parse` the result (`scriptings.ts:1117-1127`). Reproduce the `accessKey` /
   safe-id / low-level-id gating (`:1075-1083`).

### Implement — host functions (the disposition table)

8. **Pure fns** — bind directly to the server's in-memory chat / char / var engine.
   Critically, bind `getChatVar`/`setChatVar`/`getState`/`setState` to the **same**
   `createTriggerVarEngine` (`triggerVars.ts:79`) the assembler already mutates, so
   Lua's writes land in the scriptstate delta for free (see
   [README §Integration](README.md#integration-points-in-the-server-assembler)).
   `cbs` → `expandVariables` (`prompt/variables.ts`); `getTokens` → `prompt/tokens.ts`.
9. **`request(url)`** — the SSRF-guarded egress: https-only, ≤120 chars, ≤5/min,
   **plus** reject private/loopback/link-local/metadata IPs after resolution and pin
   the connection to the validated IP. (Full spec in
   [README §Security](README.md#security-design-single-user-self-host).)
10. **`LLM`/`axLLM`/`similarity`/`generateImage`/`getCharacterImage`/`getPersonaImage`**
    — gate off (return an explicit error JSON / empty) for this sub-slice; note the
    later port path (LLM → `dispatchChatProvider`, `chatDispatch.ts:642`).
11. **`alertInput`/`alertSelect`/`alertConfirm`** — throw/return null; **and** record
    that scripts using them stay `unsupported` (the finer arm lands when the
    classifier flips in sub-slice 2). `alertError`/`alertNormal`/`reloadDisplay`/
    `reloadChat` → no-op (or an SSE side-effect, your call). `sleep` → capped + counted.

### Implement — the execution limit

12. Wire the mechanism chosen in step 2 so a runaway Lua script is interrupted with a
    bounded error rather than hanging the event loop. This is the **must-have** of the
    self-host bar — a single bad char must not DoS the operator's server.

### Prove (runtime-only; no assembler wiring yet)

13. Unit tests for the new runtime file:
    - a pure `editRequest` handler that rewrites a row → asserts the transformed
      `OpenAIChat[]` (proves the prelude + dispatch + JSON round-trip);
    - `setChatVar`/`setState` mutate the bound var engine;
    - `request()` rejects `http://`, an over-120-char URL, the 6th call in a minute,
      and a URL resolving to `127.0.0.1`/`169.254.169.254`/`10.x`/`localhost`;
    - a `while true do end` script is interrupted within the limit;
    - `alertInput` fails explicitly.
14. Run the [shared verification](../README.md#shared-verification-run-before-and-after-every-slice).

### Land

15. Update the parity matrix row note in
    [`../../../reference/server-assembler-parity.md`](../../../reference/server-assembler-parity.md)
    to "VM exists; hooks pending" and tick sub-slice 1 in [README](README.md). Write a
    memory entry (mirror `phase4-slice3b-pluginv2-permanent-unsupported-landed`).

## When this sub-slice is done

- [x] A server Lua runtime runs arbitrary user Lua under the self-host security gate.
      (`server/fastify/src/prompt/luaRuntime.ts`: `runServerLua` + `runLuaEditTrigger`.)
- [x] Pure host fns at browser parity; privileged ones gated; browser/interactive ones
      fail explicitly. (Full host-fn surface declared per the disposition table;
      `alertInput`/`Select`/`Confirm` throw + flag `interactiveInvoked`.)
- [x] `request()` SSRF + rate/url/https limits enforced and tested.
      (`validateEgressUrl` + `isBlockedAddress` + `serverLuaRequest`, connection pinned
      to the validated IP; rate limit 30/min — operator-loosened from the browser's ~5.)
- [x] A runaway script is interrupted (exec limit) and tested. (wasmoon `functionTimeout`
      for dispatch + `runStringWithTimeout` for top-level code; both proven by tests.)
- [x] **No** assembler hook wired and the classifier Lua arm still routes `unsupported`.

**Landed 2026-05-29.** Tests: `server/fastify/__tests__/luaRuntime.test.ts` (17). Shared
verification green (`client-thinning:audit`, `api:test` 1294, `test` 876, `check` 0/0).
