# Slice 3b — Lua server port (handover & sub-slice series)

Date: 2026-05-29
Status: **all four sub-slices landed.**
The runtime (`server/fastify/src/prompt/luaRuntime.ts`) runs user Lua under the
single-user self-host gate, the **`editRequest` hook is wired into the assembler**
(`assemble.ts::renderAndBudget`), the **`editprocess` hook is wired into the
history pass** (`assemble.ts::fillHistoryAndBias` → `history.ts` `editProcess`
seam) as a faithful runtime no-op, and the **submit-time input trigger +
`editinput`** run in the assembler (`assemble.ts::runInputTrigger` /
`applyEditInput`; `triggerlua` on the VM via `triggers.ts::runTrigger`'s `runLua`
seam) with the route owning the post-`editinput` transcript write
(`generationChat.ts::persistAssemblyMutations`). The classifier Lua arm routes
`server` for all Lua **except** scripts using an interactive dialog API
(`alertInput`/`alertSelect`/`alertConfirm`), which stay `unsupported`.

This directory is the **slice series** the parent slice
([`../slice-3b-content-lua-plugin-scripts.md`](../slice-3b-content-lua-plugin-scripts.md))
calls for: the Lua arms of A1-content are a *committed server port*, large enough
that the parent's scope guard forbids landing the VM and all hooks in one review.
The work is split into four sub-slices, **one review each**, in order:

| # | Sub-slice | Gates | File |
| --- | --- | --- | --- |
| 1 ✅ | **Server Lua VM** (the runtime) — **landed** (`prompt/luaRuntime.ts`) | everything below | [`sub-slice-1-server-lua-vm.md`](sub-slice-1-server-lua-vm.md) |
| 2 ✅ | **`editRequest`** hook + classifier flip — **landed** (`assemble.ts::renderAndBudget`) | needs 1 | [`sub-slice-2-editrequest.md`](sub-slice-2-editrequest.md) |
| 3 ✅ | **`editprocess`** hook (Lua = browser no-op) — **landed** (`assemble.ts::fillHistoryAndBias` → `history.ts`) | needs 1 | [`sub-slice-3-editprocess.md`](sub-slice-3-editprocess.md) |
| 4 ✅ | **input-trigger / `editinput`** at submit — **landed** (`assemble.ts::runInputTrigger` / `applyEditInput`; route-owned transcript write) | needs 1 | [`sub-slice-4-editinput.md`](sub-slice-4-editinput.md) |

Do **not** pull A2's `'output'` trigger / `editoutput` in here — that is
[`../slice-4-a2-output-trigger-editoutput.md`](../slice-4-a2-output-trigger-editoutput.md),
even though it reuses the same VM.

## Decisions already made (do not relitigate)

1. **Lua is a committed server port; pluginV2 is permanent `unsupported`.** Policy
   recorded in memory `scripting-server-support-policy` and
   [`../../../unsupported-and-client-owned.md`](../../../unsupported-and-client-owned.md).
   pluginV2's permanent-unsupported half is **already landed** (2026-05-29): the
   classifier was split into a Lua arm (`sendHasLuaContent`, port-pending) and a
   pluginV2 arm (`hasPluginV2EditSet`, permanent), and the
   `A4R-pluginv2 no server-side plugin execution` audit invariant
   (`util/client-thinning-audit.ts`) forbids a server-side plugin execution path.
   **Your job is only the Lua arm.**
2. **Security model = single-user self-host** (the operator's choice, 2026-05-29).
   "Your own code on your own box": WASM sandbox (wasmoon is already WASM-isolated)
   **+ a bounded egress guard for `request()` + execution/loop limits**. This is a
   *lower* bar than hosted/multi-tenant, but it is **not "no bar"** — the server
   sits in a privileged network position the browser does not, so `request()` still
   needs an SSRF guard, and a synchronous Lua infinite loop would hang the whole
   Fastify process. See [§Security design](#security-design-single-user-self-host).
3. **`wasmoon` is already a repo dependency** (`package.json`), the same engine the
   browser uses. No new dependency decision is needed unless you choose worker-thread
   isolation (see the exec-limit options).

## Why this matters

The durable-generation subset (`docs/durable-generation/`) excludes Lua content, so
the server Lua VM is the **single biggest lever on durable-generation coverage**.
Without it, durable generation only ever covers unscripted / regex-scripted chats.
This is pre-ship work: `useServerPromptAssembly` defaults **off**, so there is no
user-facing urgency — favor a correct, well-bounded VM over speed.

## The browser engine you are porting

Everything lives in **`src/ts/process/scriptings.ts`** (~1589 lines). Read it in
full before sub-slice 1. The shape:

- **`runScripted(code, arg)`** (`:62`) — the core executor. Per `mode` it creates /
  reuses a `LuaEngine` (one per mode, behind a `Mutex`), declares ~40 host
  functions (`declareAPI`, `:118-1064`), wraps the user code with `luaCodeWrapper`,
  runs `engine.doString(...)` (`:1068`), then dispatches by mode (`:1085-1135`).
- **`luaCodeWrapper(code)`** (`:1262`) — the Lua prelude. Defines `listenEdit`
  (`:1316`), `callListenMain` (`:1380`), `getState`/`setState` (`:1340-1348`), the
  `LLM`/`axLLM`/`getChat`/`getFullChat`/`log` JSON wrappers, and `require 'json'`.
  **It mounts `public/lua/json.lua`** via `makeLuaFactory` → `mountFile('json.lua')`
  (`:1191-1208`); the browser fetches `/lua/json.lua`. The server must bundle / read
  that file from `public/lua/json.lua`.
- **edit-hook dispatch** (`:1117-1127`): for `editRequest`/`editDisplay`/`editInput`/
  `editOutput`, `runScripted` calls
  `callListenMain(mode, accessKey, JSON.stringify(data), JSON.stringify(meta))` and
  `JSON.parse`s the result. `data` for `editRequest` is the `OpenAIChat[]` rows.
- **`runLuaEditTrigger(char, mode, content, meta)`** (`:1415`) — the assembler-facing
  entry. Remaps `editinput`→`editInput` etc. (`:1421-1430`), **early-returns for
  `editprocess`** (`:1431-1432` — Lua editprocess is a no-op), then iterates
  `char.triggerscript` + `getModuleTriggers()` and runs each `triggerlua` effect's
  code, threading `data` (`:1448-1459`). Errors are swallowed → returns `content`.
- **access control** — `runScripted` mints an `accessKey` (`:1075`) added to
  `ScriptingSafeIds` (and `ScriptingLowLevelIds` if `lowLevelAccess`). Host fns
  guarded by `ScriptingLowLevelIds` are the privileged ones: `request`, `LLMMain`,
  `axLLMMain`, `similarity`, `generateImage`. `editRequest` triggers run with
  `lowLevelAccess = false` (`:1443`), so **by default the privileged host fns are
  off for edit hooks** — useful: the common editRequest path is pure.

## Host-function disposition (single-user self-host)

For each browser host fn, what the server VM should do. "Pure" = operate on the
in-memory chat / vars / char the server already has; "gate" = needs the security
bound; "browser" = no clean server semantics → error/no-op + may force `unsupported`.

| Host fn (browser) | scriptings.ts | Server disposition |
| --- | --- | --- |
| `getChatVar`/`setChatVar`/`getGlobalVar`/`getState`/`setState` | `:118-129,1340` | **Pure** — bind to the server chat-var engine (`createTriggerVarEngine`, `triggerVars.ts:79`); mutations must flow into the scriptstate delta (see [§Integration](#integration-points-in-the-server-assembler)). |
| `getChatMain`/`setChat`/`setChatRole`/`cutChat`/`removeChat`/`addChat`/`insertChat`/`getChatLength`/`getFullChatMain`/`setFullChatMain` | `:167-276` | **Pure** — operate on the working chat message array. |
| `getCharacterLastMessage`/`getUserLastMessage`/`getFirstMessage` | `:990-1064` | **Pure**. |
| `getTokens` | `:225` | **Pure** — server tokenizer (`prompt/tokens.ts`). |
| `cbs` | `:260` | **Pure** — server `risuChatParser` (`prompt/variables.ts::expandVariables`). |
| `hash` | `:456` | **Pure** — `hasher`. |
| `logMain` / `stopChat` | `:130,278` | **Pure** — `stopChat` sets the run's stop flag. |
| `similarity` | `:300` (lowLevel) | **Gate/defer** — server has embedding infra (`memory*`); not needed for editRequest. Gate off in sub-slice 1. |
| `request(url)` | `:309` (lowLevel) | **Gate** — the egress bound. See security design. |
| `LLMMain`/`axLLMMain` | `:494` (lowLevel) | **Gate/defer** — route through `dispatchChatProvider` (`chatDispatch.ts:642`) *or* gate off in sub-slice 1 (recommended: defer). |
| `generateImage` | `:372` (lowLevel) | **Browser/defer** — image gen is a B1 concern; gate off. |
| `getCharacterImageMain`/`getPersonaImageMain` | `:386,426` | **Browser/defer** — use Blob/Image in the browser; server could reuse slice 3a's `resolveStoredAssetImage`, but defer. |
| `alertError`/`alertNormal` | `:136,142` | **Browser** — no-op, or emit an SSE side-effect event. |
| `alertInput`/`alertSelect`/`alertConfirm` | `:148-165` | **Browser, interactive** — no server equivalent. Throw/return null **and** drive a finer classifier arm (see below). |
| `reloadDisplay`/`reloadChat` | `:282,289` | **Browser** — no-op (UI refresh signal). |
| `sleep` | `:249` (safe) | **Gate** — cap max sleep, count against the per-run time budget. |

**Interactive-API arm.** A Lua script that calls `alertInput`/`alertSelect`/
`alertConfirm` mid-assembly cannot run server-side. Detection is hard statically
(it is inside Lua source). Two cuts: (a) cheap — at classify time scan the Lua
source for those token names and route `unsupported`; (b) precise — run the VM and,
if an interactive host fn is invoked, abort with a specific error and fail the send
explicitly. Start with (a); never silently drop the interaction.

## Security design (single-user self-host)

The gate to design **before wiring `request()`/`LLM()`** (the parent slice says so):

- **`request(url)` — SSRF-guarded egress.** Mirror the browser's bounds (https-only,
  URL ≤120 chars, ≤5 req/min rate limit — `scriptings.ts:314-353`) **and add an
  SSRF guard the browser does not need**: resolve the host, reject any
  loopback/link-local/private/reserved IP (127/8, ::1, 169.254/16 incl. the cloud
  metadata IP 169.254.169.254, 10/8, 172.16/12, 192.168/16, fd00::/8, non-global),
  reject `localhost`. Pin the connection to the validated IP to avoid DNS-rebinding
  TOCTOU. Consider a config egress allow-list (off by default = deny-by-resolution).
- **`LLM()`/`axLLM()` — recommend deferring** in sub-slice 1 (return an error JSON):
  most `editRequest` scripts never call them, and it de-risks the VM. When ported,
  route through the server's `dispatchChatProvider` (`chatDispatch.ts:642`) +
  `getServerGenerationModelString` (`:1023`), reusing server secret handling — not
  the browser's `requestChatData`.
- **Execution / loop limits — the sharpest self-host risk.** wasmoon runs Lua
  **synchronously on the Node event loop**; an infinite loop hangs the whole Fastify
  process (a DoS of your own server). Options, in preference order:
  1. **Lua instruction-count hook** (`lua_sethook` after N instructions) — deterministic
     interrupt. Investigate whether wasmoon exposes the low-level `lua`/`cengine` API
     to set it; this is the cleanest if available.
  2. **`worker_threads` isolation** + wall-clock timeout + `worker.terminate()` —
     robust (also bounds memory) but adds per-call serialization and complicates
     host fns that touch the chat/db (message-passing). Heavier.
  3. A coarse async-boundary timeout alone is **insufficient** (can't interrupt a sync
     loop). Document whichever you pick.

## Integration points in the server assembler

Where each hook wires (exact seams; the editRequest seam *already exists*, unused):

- **`editRequest`** ✅ **wired (sub-slice 2)** — the injectable seam is typed at
  **`templates.ts:635`** (`editRequest?: (rows: OpenAIChat[]) => OpenAIChat[] | Promise<…>`),
  applied at `:725-730` (over `formated` and the `promptInfo` capture).
  `renderAndBudget` now supplies a VM-backed one via `buildLuaEditRequest`
  (`assemble.ts`): `(rows) => runLuaEditTrigger(currentChar, 'editRequest', rows,
  undefined, ctx)`, threading a `createTriggerVarEngine` (bound to the db chat
  scriptstate) + the active `moduleTriggers`. Supplied unconditionally for parity;
  no Lua engine boots when there is no `triggerlua` effect. Mind the **two-stage**
  note (`local-assembler-content-classes.md` §4): the dispatch layer also edits rows
  — but on the server, dispatch is the assembler, so only the assembly-time
  `editRequest` applies here.
- **`editprocess`** ✅ **wired (sub-slice 3)** — runs in the history pass next to
  `processScript` (`scripts.ts:315`, applied at the two `history.ts` call sites). The
  injectable `editProcess` seam (`history.ts`, default identity) runs between the
  `expandVariables` pre-pass and the regex processor, mirroring `processScriptFull`'s
  leading `runLuaEditTrigger`. `assemble.ts::fillHistoryAndBias` supplies a VM-backed
  `runLuaEditTrigger(char, 'editprocess', …)` hook (via the shared
  `buildLuaEditTriggerContext`). Lua `editprocess` is a browser no-op — the runtime
  early-returns — so this is identity at parity; routed through the VM (not a hardcoded
  identity) so it stays faithful if the browser ever changes. No `varChanged` fold (the
  no-op never writes vars). The `scripts.ts` header note was corrected accordingly.
- **`editinput`** ✅ **wired (sub-slice 4)** — there was **no submit-time server
  seam**: it runs at *submit*, before assembly (`DefaultChatScreen.svelte:229-244`).
  Sub-slice 4 adds two pre-assembly steps in `assemble.ts`: `runInputTrigger` (runs
  `runTrigger('input')` over the transcript *without* the new user message — it is
  excluded and re-added — adopting a rewrite only on a real change) and
  `applyEditInput` (`runLuaEditTrigger('editinput')` → CBS → `processScript`
  `editinput` over the appended user row). The browser sends the **raw** user text
  for a server-backed send and skips both transforms; the route **owns** the
  post-`editinput` transcript write (`persistAssemblyMutations`, only when a hook
  changed it). The two B1 input-plumbing branches (slash text, file-inlay insertion,
  `DefaultChatScreen.svelte:203-216`) stay browser — unchanged.
- **chat-var persistence** — Lua `setChatVar`/`setState` during an assembly-time hook
  is captured the same way the `'start'` trigger's are: the snapshot is
  `initialScriptstate`, the delta is `buildChatVarMutations`, persisted by the route
  via `persistAssemblyMutations` (renamed from `persistAssemblyChatVars`, which now
  also writes the submit transcript). The VM's var host fns bind to the **same**
  engine the assembler mutates, so the delta picks Lua's writes up for free — this
  holds for the input trigger (its own `createTriggerVarEngine`) and `editinput`
  (the shared `buildLuaEditTriggerContext`) alike.
- **triggers** ✅ **wired (sub-slice 4)** — `runTrigger` now has a `case 'triggerlua'`
  arm that calls the VM via an injected `TriggerRunContext.runLua` seam. Only
  `runInputTrigger` injects it (the submit-time input trigger), so the start-trigger
  path still no-ops `triggerlua` (editRequest runs via the template seam, not
  `runTrigger`) — preserving sub-slice 2's behavior.

## Classifier flips (per sub-slice)

**Landed in sub-slice 2.** The Lua arm in
`src/ts/process/request/serverPromptAssembly.ts` cannot tell statically which edit
mode a script hooks (handlers register at runtime via `listenEdit`), so the flip is
the whole Lua arm → `server` *minus* the interactive-API arm. The predicate is now
`luaUsesInteractiveApi` (replacing the old `sendHasLuaContent` "any Lua →
`unsupported`"): it source-scans `triggerlua` effects for
`alertInput`/`alertSelect`/`alertConfirm` and keeps only those `unsupported`; all
other Lua routes `server`. Consequence — a non-interactive Lua char that only hooks
`editprocess`/`editinput` routes `server` ahead of those execution seams (sub-slices
3/4); acceptable pre-ship (flag default-off, no users), tighten in 3/4. Classifier
table tests updated in `request/tests/serverPromptAssembly.test.ts`.

## Shared proof shape (every sub-slice)

Inherit [`../README.md` §Shared verification](../README.md#shared-verification-run-before-and-after-every-slice):
`pnpm client-thinning:audit` → `pnpm api:test` → `pnpm test` (+ `pnpm check`). Plus,
per ported hook:

- **Server parity** in `server/fastify/__tests__/generation.chat.test.ts`: a char
  whose Lua hook edits the prompt; assert the server-assembled prompt reflects the
  edit (vs the regex-only baseline).
- **Parity fixture** in `sendChat.fixtures.serverBacked.test.ts` Describe B: server
  == local golden for a char with a `triggerscript` Lua hook.
- **Classifier test**: the ported sub-class now asserts `server`; the
  interactive-API arm keeps asserting `unsupported`.
- **Security tests** (sub-slice 1): `request()` rejects private/loopback/metadata
  IPs and over-limit calls; the exec-limit interrupts a runaway script.

## Open questions — RESOLVED in sub-slice 1

1. **Exec-limit mechanism — ✅ wasmoon's built-in `lua_sethook` count hook (option 1).**
   wasmoon 1.16.0 installs an instruction-count hook (every 1000 ops) that throws when
   wall-clock passes a deadline, surfaced as `createEngine({ functionTimeout })` (bounds
   every JS→Lua call — the dispatch) and `thread.run(argCount, { timeout })` (bounds a
   loaded chunk). `luaRuntime.ts` uses **both**: `functionTimeout` for dispatch +
   `runStringWithTimeout` for the top-level user code, so a top-level `while true do end`
   is bounded too. No worker-thread fallback needed. (The timeout surfaces as a generic
   `Error` whose message contains "timeout" — the `LuaTimeoutError` class is lost across
   the Lua→JS boundary — so it is detected by message.)
2. **`json.lua` delivery — ✅ read `public/lua/json.lua` from disk at boot**, path
   resolved relative to `import.meta.url` (deterministic under `pnpm api:test`). Mounted
   once into a module-singleton `LuaFactory`.
3. **Engine lifetime — ✅ per-call isolation.** Singleton factory (wasm + json.lua), fresh
   `createEngine` per `runServerLua` call, closed in `finally`; access-control sets are
   per-call closures. No cross-chat global leakage.
4. **OpenAIChat round-trip — ✅ confirmed** byte-faithful for the text-send subset (the
   `editRequest` unit test edits a row's `.content` and asserts it round-trips). Multimodal
   `name`/`multimodals` field round-trip is re-confirmed when sub-slice 2 wires the real
   `renderFinalPrompt` editRequest seam.
