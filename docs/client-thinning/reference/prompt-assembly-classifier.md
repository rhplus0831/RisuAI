# Reference: Prompt-Assembly Classifier (A1 foundation)

Date: 2026-05-29

Backs Phase 4 work-order item **1**. This slice has landed:
`resolveServerPromptAssembly` now returns `server | local | unsupported`,
mirrors the `resolveServerCompletionRoute` shape, and makes the supported subset
server-mandatory when Fastify mode and `useServerPromptAssembly` are both on. See
[`../status/sendchat-thinning.md`](../status/sendchat-thinning.md) for the live
A/B triage.

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

The gate is a classifier verdict (`index.svelte.ts:166-217`):

```ts
const assemblyRoute = resolveServerPromptAssembly({ currentChar, currentChat, ... })
if (assemblyRoute.type === 'unsupported') { throwError(assemblyRoute.reason); return false }
if (assemblyRoute.type === 'server') { ... assembleServerBackedSendChat(...) ... }
// assemblyRoute.type === 'local' falls through to the local assembler.
```

`unsupported` is terminal and never falls through. `server` calls
`assembleServerBackedSendChat` and handles `aborted | failed | preview |
assembled`; `local` is limited to non-Fastify mode or the default-off master
flag. The A1 negative proof targets the single `assembleLocalSendChatPrompt`
branch and shows it is unreachable for the supported subset when the flag is on.

### Historical pre-slice-1 hole (closed)

Before slice 1, `assembleServerBackedSendChat` had a soft escape:

```ts
const mode = serverChatMode(args)
const lastMessage = args.currentChat.message.at(-1)
const userMessage = mode === 'send' && lastMessage?.role === 'user' ? lastMessage.data : undefined
const canUseServerAssembly = mode !== 'send' || typeof userMessage === 'string'
if (!canUseServerAssembly) return { status: 'unavailable' }
```

`sendChat` did not handle `'unavailable'`, so that status silently fell through
to local assembly. The landed classifier moved the structural and content checks
before the server call and deleted this status. Do not reintroduce an
`unavailable` or "try server then fall back local" path in Fastify mode with the
flag on.

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

The body is built by `assembleServerBackedSendChat`: it always sets
`chatId`/`characterId`/`mode`, conditionally `userMessage` (string only) and
`regenerateMessageId`, and as of slice 3a populates `inlayAssets` for referenced
browser-local inlay bytes. `presetId`, `loadoutId`, `resetMessages`, and
`expectedRevision` remain optional request fields but are not part of the current
client path.

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
  INCOMPLETE-MIGRATION GATE — not a stable user setting and NOT deprecated."
  A1 content parity is landed, but the flag remains default-off while local
  assembly is still the default production path and the remaining unsupported
  cases / provider-resolver differences are explicit.
- **`useServerGeneration`**: removed 2026-05-29 (was dead).

Every production read of `useServerPromptAssembly`:

| Site | Role |
| --- | --- |
| `src/ts/process/request/serverPromptAssembly.ts` | master enable read before routing `server`/`unsupported` |
| `src/ts/storage/database.svelte.ts:779,1368` | default + type |
| `src/lib/Others/HypaV3Modal.svelte:44` | gates a HypaV3 server-memory UI affordance |
| `src/ts/server/commands.ts:319,355` | classified as a `'runtime'`-class projectable setting |
| `server/fastify/src/routes/generationChat.ts` | server mirror gate: whether `/chat` also dispatches the provider |
| `server/fastify/src/routes/commands.ts:410,789` | command-route allow-list / runtime-key registry |

## The target — `resolveServerPromptAssembly`

**Landed (slice 1).** `src/ts/process/request/serverPromptAssembly.ts` exports the
pure `resolveServerPromptAssembly(input)` returning
`{ type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason }`,
mirroring `resolveServerCompletionRoute`. It replaced the boolean gate at
`index.svelte.ts`: the gate is now a switch on the verdict — `server` runs
`assembleServerBackedSendChat`, `unsupported` calls `throwError(reason)` +
`return false` (no fall-through), and `local` falls through to
`assembleLocalSendChatPrompt`. The silent `unavailable` escape in
`serverBackedSendChat.ts` is deleted.

Decision order in the implementation: `!isFastifyServer` → `local`; the
experimental `useServerPromptAssembly` master-enable off → `local` (the one
`local` verdict that survives in Fastify mode until a separate flag-removal
closeout); then mode/user-message structural check, group check, provider
routability (delegated to `resolveServerCompletionRoute`), and the content-signal
check — each out-of-subset signal → `unsupported`; otherwise `server`. Note the
route itself also runs the `/generate/chat` provider resolver in
`prompt/chatDispatch.ts`, so `/chat` can still hard-fail a provider shape that the
completion resolver supports; there is still no browser fallback. The content
detector keeps one named predicate per class so future changes can flip exactly
one class.

### The supported subset (returns `server`)

A send is in the subset the server `/chat` assembler already handles iff **all**
hold. The table names where each signal is detected and whether the gate exists
today:

| Condition | Detected at | Gate today |
| --- | --- | --- |
| Fastify mode + flag on | `serverPromptAssembly.ts:207-208` | yes |
| Mode `send` with a string user message (or a non-`send` mode) | `serverPromptAssembly.ts:210-220` | yes, hard-fails unsupported |
| Single, non-group character | `serverPromptAssembly.ts:222-230`; groups also filtered at `database.svelte.ts:110` | yes |
| Server-routable provider | `resolveServerCompletionRoute` inside `serverPromptAssembly.ts:232-241` | yes |
| No unsupported content | `sendHasUnsupportedContent` (`serverPromptAssembly.ts:128-155`) | yes; slices 3a/3b/3c graduated image-input multimodal/asset, non-interactive Lua, and image-gen instruction to `server` |

The current remaining unsupported content signals are non-vision image caption,
interactive Lua dialog APIs, and pluginV2. The image-gen / emotion view
instruction is no longer an unsupported signal; slice 3c routes it to `server`.

### Proof landed for this batch

- `src/ts/process/request/tests/serverPromptAssembly.test.ts` covers the
  three-way verdict and content signals.
- `src/ts/process/__tests__/sendChat.serverPreview.test.ts` proves an
  out-of-subset interactive-Lua send hard-fails without local or `/chat`, while
  non-interactive Lua routes to `/chat`.
- `util/client-thinning-audit.ts` pins the classifier presence and Fastify
  server-mandatory guard.

See [`proof-points.md`](proof-points.md) for the exact test files and harness.
