# Slice 3b — Lua server port (handover & sub-slice series)

Date: 2026-05-29
Status: **not started** — this is a handover for the next agent.

This directory is the **slice series** the parent slice
([`../slice-3b-content-lua-plugin-scripts.md`](../slice-3b-content-lua-plugin-scripts.md))
calls for: the Lua arms of A1-content are a *committed server port*, large enough
that the parent's scope guard forbids landing the VM and all hooks in one review.
The work is split into four sub-slices, **one review each**, in order:

| # | Sub-slice | Gates | File |
| --- | --- | --- | --- |
| 1 | **Server Lua VM** (the runtime) | everything below | [`sub-slice-1-server-lua-vm.md`](sub-slice-1-server-lua-vm.md) |
| 2 | **`editRequest`** hook + classifier flip | needs 1 | [`sub-slice-2-editrequest.md`](sub-slice-2-editrequest.md) |
| 3 | **`editprocess`** hook (Lua = browser no-op) | needs 1 | [`sub-slice-3-editprocess.md`](sub-slice-3-editprocess.md) |
| 4 | **input-trigger / `editinput`** at submit | needs 1 | [`sub-slice-4-editinput.md`](sub-slice-4-editinput.md) |

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

- **`editRequest`** — the injectable seam is already typed at
  **`templates.ts:635`** (`editRequest?: (rows: OpenAIChat[]) => OpenAIChat[] | Promise<…>`),
  applied at `:725-730` (over `formated` and the `promptInfo` capture). It is just
  never supplied: `renderAndBudget` calls `renderFinalPrompt` **without** an
  `editRequest` key at **`assemble.ts:1082`**. Sub-slice 2 supplies a VM-backed one.
  Mind the **two-stage** note (`local-assembler-content-classes.md` §4): the dispatch
  layer also edits rows — but on the server, dispatch is the assembler, so only the
  assembly-time `editRequest` applies here.
- **`editprocess`** — runs in the history pass next to `processScript`
  (`scripts.ts:315`, applied `history.ts:292-300,452-457`). The `scripts.ts:50-56`
  header already documents the Lua deferral. Lua `editprocess` is a browser no-op, so
  sub-slice 3 is near-identity (prove parity, flip nothing structural).
- **`editinput`** — **no server seam exists**: it runs at *submit*, before assembly
  (`DefaultChatScreen.svelte:229-244`), and `/generate/chat` is currently stateless
  re the chat blob. Sub-slice 4 adds a pre-assembly server hook that runs
  `runTrigger('input')` + `processScript('editinput')`. Do **not** conflate the two
  B1 input-plumbing branches (slash text, file-inlay insertion,
  `DefaultChatScreen.svelte:203-216`) — those stay browser.
- **chat-var persistence** — Lua `setChatVar`/`setState` during an assembly-time hook
  must be captured the same way the `'start'` trigger's are: the snapshot is
  `initialScriptstate` (`assemble.ts:445`), the delta is `buildChatVarMutations`
  (`:619`), persisted by the route via `persistAssemblyChatVars`
  (`generationChat.ts:293`). Bind the VM's var host fns to the **same** engine the
  assembler already mutates so the delta picks Lua's writes up for free.
- **triggers** — the server `triggerlua` arm currently bypasses the mode filter and
  **falls through as a no-op** (`triggers.ts:264-280,817-834`). Replace those no-ops
  with VM calls when sub-slice 2/4 land; until then they stay no-ops.

## Classifier flips (per sub-slice)

The Lua detector is `sendHasLuaContent` in
`src/ts/process/request/serverPromptAssembly.ts` (currently `→ unsupported`). It
detects `triggerlua` presence but **cannot tell statically which edit mode a script
hooks** (handlers register at runtime via `listenEdit`). So a faithful flip means:
once the VM runs a script, it must support whatever that script registers (or fail
explicitly). Practical consequence — you likely flip the whole Lua arm to `server`
when the VM + the common hooks (editRequest/editprocess/editinput) are all live,
*minus* the interactive-API arm which stays `unsupported`. Plan the flip in
sub-slice 2 (editRequest is the dominant case) and tighten in 3/4. Update the
classifier table tests (`request/tests/serverPromptAssembly.test.ts`) with each flip.

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

## Open questions for the next agent

1. **Exec-limit mechanism** — does the installed wasmoon expose `lua_sethook` (option
   1) or must you fall back to worker isolation (option 2)? Resolve in sub-slice 1.
2. **`json.lua` delivery** — bundle a copy into the server, or read `public/lua/json.lua`
   from disk at boot? Pick one and make it deterministic in tests.
3. **Per-mode engine reuse vs per-send** — the browser keeps one `LuaEngine` per mode
   behind a Mutex and recreates it when `code` changes. On the server, decide whether
   to reuse across sends (faster, but shared global state across chats) or create per
   send (isolated, slower). Single-user self-host tolerates either; prefer isolation.
4. **OpenAIChat shape round-trip** — confirm the server `formated` rows serialize to
   the same `{role, content, …}` JSON the browser's `callListenMain` expects, and
   back (multimodal fields, `name`, etc.).
