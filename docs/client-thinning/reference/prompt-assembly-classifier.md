# Reference: Prompt-Assembly Classifier (A1 foundation)

Date: 2026-05-29

Backs Phase 4 work-order item **1** — build `resolveServerPromptAssembly`
(`server | local | unsupported`, mirroring `resolveServerCompletionRoute`) and
replace the `useServerPromptAssembly` runtime gate so the supported text-send
subset is server-mandatory. See [`../phases/phase-4-sendchat-thinning.md`](../phases/phase-4-sendchat-thinning.md)
for the work order and [`../status/sendchat-thinning.md`](../status/sendchat-thinning.md)
for the A/B triage. This doc is the deep code routing for that batch.

Line numbers are anchors that may drift; the symbol names next to them are the
stable handle. All paths are from the repo root.

## The precedent to mirror — `resolveServerCompletionRoute`

File: `src/ts/process/request/serverCompletion.ts`.

The classifier returns a three-arm tagged union (`serverCompletion.ts:13-16`):

```ts
export type ServerCompletionRoute =
  | { type: 'local' }
  | { type: 'server'; provider: string }
  | { type: 'unsupported'; reason: string }
```

Note the asymmetry to copy: `local` is a bare tag, `server` carries the resolved
`provider`, `unsupported` carries a human-readable `reason` surfaced to the user
as the failure message.

The function body (`serverCompletion.ts:538-576`), in decision order:

1. **`local` is reachable only when `!isFastifyServer`** — the very first line
   (`serverCompletion.ts:541`): `if (!isFastifyServer) return { type: 'local' }`.
   This is the only `local` return. In Fastify mode the result is always `server`
   or `unsupported`; local is unreachable.
2. Preview bodies hard-fail as `unsupported` (`:542-548`).
3. No `modelInfo` → `unsupported` (`:549-554`).
4. `formatToServerProvider(format)` (`:18-61`) maps `LLMFormat` → a coarse
   provider string or `null`; `null` → `unsupported` (`:555-557`).
5. Per-provider "vanilla" refinement (`:558-571`): each family is narrowed by a
   guard (`selectOpenAIVariant`, `isVanillaAnthropic`, … `resolveOllamaProvider`)
   that returns the routed provider or `null` when the credential/config shape
   isn't server-routable.
6. `routedProvider === null` → `unsupported` (`:572-574`); else
   `{ type: 'server', provider: routedProvider }` (`:575`).

The `unsupported` reason text comes from `unsupportedServerGenerationReason`
(`serverCompletion.ts:533-536`). A thin helper `getServerCompletionProvider`
(`:578-581`) returns `route.provider` or `null`.

**The call site and the hard-fail shape** — `requestChatData` in
`src/ts/process/request/request.ts:522-532`:

```ts
const serverRoute = resolveServerCompletionRoute(targ)
if (serverRoute.type === 'server') {
  return requestServerCompletion(targ, serverRoute.provider, abortSignal)
}
if (serverRoute.type === 'unsupported') {
  return { type: 'fail', result: serverRoute.reason, noRetry: true }
}
```

`unsupported` returns `{ type: 'fail', noRetry: true }` — the `noRetry` flag
(`request.ts:82`) makes it a *terminal* user-facing error, never a retry or a
fallback. `local` falls through into the in-browser provider `switch`
(`request.ts:534-578`), which is dead code in Fastify mode because `local` is
only produced when `!isFastifyServer`. **This "server-mandatory with a hard-fail
escape, no silent local fallback" shape is exactly what the A1 classifier must
reproduce for prompt assembly.**

Proof of the three-way verdict: `src/ts/process/request/tests/serverCompletion.test.ts:162-202`
(see [`proof-points.md`](proof-points.md)).

## The current sendChat assembly gate

File: `src/ts/process/index.svelte.ts`.

`sendChat` is the coordinator (`index.svelte.ts:54-65`):

```ts
export async function sendChat(
  chatProcessIndex = -1,
  arg: { chatAdditonalTokens?; signal?; continue?; usedContinueTokens?;
         preview?; previewPrompt?; regenerateMessageId? } = {},
): Promise<boolean>
```

The server-vs-local gate is a single boolean (`index.svelte.ts:162`):

```ts
if (isFastifyServer && DBState.db.useServerPromptAssembly) {
```

Inside, it calls `assembleServerBackedSendChat` and switches on
`serverAssembly.status` (`index.svelte.ts:177-199`), handling only
`aborted | failed | preview | assembled`. Local assembly is the fall-through
(`index.svelte.ts:202-217`), guarded by `if (!assembledByServer)` — the **only**
call to `assembleLocalSendChatPrompt`. The A1 negative proof ("the local
assembler is unreachable for the supported subset") targets this branch.

### The silent fall-through hole (must be closed)

`assembleServerBackedSendChat` has a soft escape
(`src/ts/process/serverBackedSendChat.ts:139-143`):

```ts
const mode = serverChatMode(args)
const lastMessage = args.currentChat.message.at(-1)
const userMessage = mode === 'send' && lastMessage?.role === 'user' ? lastMessage.data : undefined
const canUseServerAssembly = mode !== 'send' || typeof userMessage === 'string'
if (!canUseServerAssembly) return { status: 'unavailable' }
```

**`sendChat`'s status switch has no `case 'unavailable'`.** When assembly returns
`unavailable`, none of the branches fire, `assembledByServer` stays `false`, and
execution falls through to local assembly at `index.svelte.ts:202` — a *silent*
local fallback even with the flag on. The status `'unavailable'` is declared at
`serverBackedSendChat.ts:46` and returned at `:143`; it appears nowhere in
`index.svelte.ts`. An implementer replacing the gate must remove this
fall-through, not merely the `unavailable` return.

Worse: **no content signal (asset/image/Lua/plugin) is inspected on the
server-backed path at all.** `assembleServerBackedSendChat` looks only at `mode`
and whether the last user message is a string. So with the flag on, a send
carrying image/asset/Lua/plugin content is *silently mis-assembled by the server*
(bytes/instructions dropped) rather than classified `unsupported`. Closing this
is the core of the A1 classifier. See
[`server-assembler-parity.md`](server-assembler-parity.md) (what the server
drops) and [`local-assembler-content-classes.md`](local-assembler-content-classes.md)
(where to detect each signal).

## Send modes

`sendChat` has no single mode enum; the mode is derived in `serverChatMode`
(`serverBackedSendChat.ts:84-95`):

```ts
if (args.previewPrompt) return 'preview_prompt'
if (args.preview) return 'preview'
if (typeof args.regenerateMessageId === 'string') return 'regenerate'
if (args.continue) return 'continue'
return 'send'
```

Union: **`send | continue | preview | preview_prompt | regenerate`**
(`ServerChatInput['mode']`, `src/ts/process/request/serverChat.ts:40`). Real sends
(`!preview && !previewPrompt`) use `requestServerChatGeneration` (full provider
dispatch + token stream); the two preview modes use `requestServerChat`
(assembled-prompt only) — selected at `serverBackedSendChat.ts:159-162`.

`chatProcessIndex` is **not** a group index — it is the autopilot / multi-process
slot (`-1` = fresh top-level send; `>= 0` = reentrant/queued). See the autopilot
loop at `src/lib/SideBars/DevTool.svelte:242-261` and the `iOwnDoingChat`
reentrancy contract at `index.svelte.ts:114-129`.

## The server bridge — `serverChat.ts`

File: `src/ts/process/request/serverChat.ts`. Both senders POST to
`CHAT_ENDPOINT = '/api/v1/generate/chat'` (`serverChat.ts:34`) via `openChatResponse`
(`:101-145`):

- `requestServerChat(input, signal)` (`:152-211`) — preview / preview_prompt;
  consumes SSE `prompt`, `info`, `message_patch`, `error`, `done`.
- `requestServerChatGeneration(input, signal)` (`:256-415`) — real send / continue
  / regenerate; additionally consumes `side_effect`, `token` (a
  `ReadableStream<StreamResponseChunk>`), with `ready` + `terminal` promises.

Request body type `ServerChatInput` (`serverChat.ts:37-48`):

```ts
export interface ServerChatInput {
  chatId: string
  characterId: string
  mode: 'send' | 'continue' | 'preview' | 'preview_prompt' | 'regenerate'
  userMessage?: string
  regenerateMessageId?: string
  presetId?: string
  loadoutId?: string
  resetMessages?: boolean
  expectedRevision?: number
  inlayAssets?: unknown[]
}
```

The body is built at `serverBackedSendChat.ts:147-157`: it always sets
`chatId`/`characterId`/`mode`, conditionally `userMessage` (string only) and
`regenerateMessageId`. **`presetId`, `loadoutId`, `resetMessages`,
`expectedRevision`, and `inlayAssets` are declared but never populated by the
client today** — do not assume `inlayAssets` plumbing exists (it is also unused
server-side; see [`server-assembler-parity.md`](server-assembler-parity.md)).

POST mechanics (`serverChat.ts:111-120`): `content-type: application/json`,
`risu-auth` from `getNodeServerProxyAuth()`, plus `activeWriterSessionHeader()`.

## Runtime gates

- **`isFastifyServer`** (`src/ts/platform.ts:24-26`):
  `!!(globalThis).__FASTIFY__`. True only when the Fastify server injected the
  marker while serving the SPA; `false` under `pnpm dev` and in tests. Annotated
  in-code (`platform.ts:16-23`) as the live routing gate — **not deprecated**.
- **`useServerPromptAssembly`** (`src/ts/storage/database.svelte.ts`): default
  `false` at `database.svelte.ts:779` (`data.useServerPromptAssembly ??= false`);
  type + JSDoc at `:1354-1368`. The JSDoc calls it an "EXPERIMENTAL /
  INCOMPLETE-MIGRATION GATE — not a stable user setting and NOT deprecated …
  Do NOT default-enable or delete this flag until server assembly reaches parity
  and the local fallback is retired — removing it is the END of that work, not a
  precursor."
- **`useServerGeneration`**: removed 2026-05-29 (was dead).

Every production read of `useServerPromptAssembly`:

| Site | Role |
| --- | --- |
| `src/ts/process/index.svelte.ts:162` | the send gate (the one the classifier replaces) |
| `src/ts/storage/database.svelte.ts:779,1368` | default + type |
| `src/lib/Others/HypaV3Modal.svelte:44` | gates a HypaV3 server-memory UI affordance |
| `src/ts/server/commands.ts:319,355` | classified as a `'runtime'`-class projectable setting |
| `server/fastify/src/routes/generationChat.ts:200` | server mirror gate: whether `/chat` also dispatches the provider |
| `server/fastify/src/routes/commands.ts:410,789` | command-route allow-list / runtime-key registry |

## The target — `resolveServerPromptAssembly`

It does not exist yet (`rg resolveServerPromptAssembly` is empty). Build it to
mirror `resolveServerCompletionRoute`: a pure function returning
`{ type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason }`,
with `local` reachable only when `!isFastifyServer`, and `unsupported` carrying a
user-facing reason. Replace the boolean gate at `index.svelte.ts:162`, route
`server`/`local` to the existing assembly paths, and make `unsupported` a hard
fail (no fall-through to local).

### The supported subset (returns `server`)

A send is in the subset the server `/chat` assembler already handles iff **all**
hold. The table names where each signal is detected and whether the gate exists
today:

| Condition | Detected at | Gate today |
| --- | --- | --- |
| Fastify mode + flag on | `index.svelte.ts:162` | the entire current gate |
| Mode `send` with a string user message (or a non-`send` mode) | `serverBackedSendChat.ts:140-143` | yes, but as a silent `unavailable` |
| Single, non-group character | groups filtered at `database.svelte.ts:110`; `isGroupChat` hardcoded `false` at `dispatch/dispatchRequest.ts:106`; server has no group branch | **no explicit check** — relies on the upstream filter |
| Server-routable provider | `resolveServerCompletionRoute` (above); server mirror gate `generationChat.ts:191-202` | yes (separate, existing classifier) |
| No asset / image-gen / Lua / plugin content | content lives in `currentChat.message[].multimodals`/`.data`, `currentChar.newGenData`/`viewScreen`, plugin/Lua registration | **none inspected** — this is the hole |

Only the provider half (`resolveServerCompletionRoute`) and the
mode/string-user-message half exist. The character-group and content-class
detectors are net-new; see the two assembler docs for exactly which fields and
runtimes signal each content class.

### Proof obligation for this batch

- A classifier unit test mirroring `serverCompletion.test.ts`'s
  per-case table + three-way verdict.
- A negative test that `assembleLocalSendChatPrompt` is unreachable for the
  supported subset in Fastify mode (i.e. the `index.svelte.ts:202` branch is not
  taken), and that out-of-subset shapes return `unsupported`, not `local`.
- Keep the existing route-backed sweep green
  (`sendChat.fixtures.serverBacked.test.ts` Describe B,
  `sendChat.serverPreview.test.ts`).
- Add the classifier's presence to the audit alongside EC1
  (`util/client-thinning-audit.ts:1234`).

See [`proof-points.md`](proof-points.md) for the exact test files and harness.
