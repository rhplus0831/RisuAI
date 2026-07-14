# Reference: Proof Points (tests, fixtures, audit)

Date: 2026-05-30

What pins the current chat-process behavior, what each batch must keep green, and
what it must add. Pairs with [`../status/sendchat-thinning.md`](../status/sendchat-thinning.md#verification-coverage)
(the expected coverage shape per batch). Line anchors may drift; symbols are the
stable handle. All paths from the repo root.

## Proof-lead test files

| File | Pins | Relevance |
| --- | --- | --- |
| `server/fastify/__tests__/generation.chat.test.ts` | `/generate/chat` SSE taxonomy, assembler parity, `message_patch` shape, C-A1 scriptstate persistence, unsupported-provider matrix | A1 parity, C-A1, classifier precedent |
| `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts` | server-backed dual-mode sweep; route-backed `/chat` assembly vs local golden snapshots | A1 bridge; C-A1 zero-scriptstate-command proof |
| `src/ts/process/__tests__/sendChat.serverPreview.test.ts` | preview/preview_prompt/regenerate/send via `/chat` with the flag on; the gate off-switch | A1 foundation |
| `src/ts/process/request/tests/serverChat.test.ts` | `requestServerChat`/`requestServerChatGeneration` SSE consumption | A1 bridge |
| `src/ts/process/request/tests/serverCompletion.test.ts` | `resolveServerCompletionRoute` three-way verdict + routability matrix | **the pattern the A1 classifier tests copy** |
| `src/ts/process/__tests__/command.projectionGuard.test.ts` | slash-command optimistic writes under the projection guard; live `PATCH …/scriptstate` POST | C-A1, guard |
| `src/ts/process/__tests__/outputTrigger.test.ts` | `applyOutputTrigger` → `runTrigger('output')`, run-var pass, `resendChat` | **A2** browser behavior |
| `src/ts/process/__tests__/sendChatContext.test.ts` | entry-context durable writes through commands; revision serialization | C-A1-adjacent |
| `src/ts/process/request/tests/serverMessagePatch.test.ts` | `applyServerMessagePatch` (client replay of `message_patch`) | C-A1 |
| `src/ts/process/__tests__/sendChat.fixtures.test.ts` | the 38-fixture **local** golden master | the snapshot serverBacked shares |

### `generation.chat.test.ts` — the load-bearing server proofs

- **SSE order** for a normal send: `['stage','stage','stage','prompt','message_patch','stage','info','done']`
  (`:378-387`); `formated` projects 1:1 onto `messages` (`:396-398`); `message_patch`
  shape `toMatchObject({ chatId, characterId, messageMutations, chatVarMutations })`
  (`:401-406`).
- **C-A1 persistence:** a `setvar` start trigger emits
  `chatVarMutations: [{ key:'$score', before:null, after:'9' }]`; `/generate/chat`
  persists it, returns a bumped revision, and bootstrap afterwards shows
  `scriptstate: { $score: '9' }`. Preview remains read-only.
- **Classifier precedent:** the unsupported-provider `it.each` matrix proves the
  `/generate/chat` provider resolver emits explicit `error` frames with no token
  frames for unsupported `/chat` shapes (NovelAI/NovelList, plugin providers,
  WebLLM, Ooba OpenAI-compatible chat, unknown OpenAI-compatible models). This is
  the server-chat counterpart to `resolveServerCompletionRoute`'s `unsupported`
  arm; the routing decision is shared through `resolveProviderCapability`, while
  path-specific derivation and reason prose stay source-defined.
- **Gate on:** `:679-725` seeds `useServerPromptAssembly: true` + an echo model and
  asserts production server dispatch.

### `sendChat.fixtures.serverBacked.test.ts` — three describes

- **A** `'sendChat fixtures (server-backed)'` (`:547`): 12 providers; asserts the
  shared snapshot equals the local sweep and browser-side `providerCalls` is `[]`
  (`:620-623`), plus exactly one `/api/v1/generate/completion` POST per provider.
- **B** `'/chat route-backed prompt assembly'` (`:638`): **the A1 parity bridge.**
  Stands up a real Fastify app (`createRouteBackedHarness`, `:381-481`) that routes
  `/api/v1/generate/chat` through `app.inject`, **proxies `/api/v1/commands/*`**
  (`:430-440`), and stubs the provider via `dispatchProvider`. Sets
  `useServerPromptAssembly = true` (`:508`). Covers
  `['simple-send','continue','regenerate','preview','preview-prompt']` (`:165-171`).
  A1 content classes expanded this list with multimodal/asset, Lua, and image-gen
  fixtures; A2 adds output-trigger and `editoutput` route-backed cases. C-A1 is
  covered by the zero outbound `/chats/:id/scriptstate` POST assertion and
  revision reconciliation.
- **C** `'/chat adapter replay'` (`:741`): hypav3 patch + side-effect replay,
  rollback on dispatch failure, single server-sent TTS.

### `serverCompletion.test.ts` — the classifier test pattern

`describe('getServerCompletionProvider')` (`:145`) is an exhaustive
`makeTarg`-table routability matrix (~60 cases). The three-way verdict is pinned
at `:162-202` (`previewBody` → `unsupported`; NovelAI → `unsupported`; `local`
indirectly via `getServerCompletionProvider` null when `!isFastifyServer`). The
landed `resolveServerPromptAssembly` tests mirror this layout in
`src/ts/process/request/tests/serverPromptAssembly.test.ts`.

## Test infrastructure

- **Fixture loader** `src/ts/process/__fixtures__/loadFixture.ts` (`loadFixture(name)`
  reads `db/<name>.json`, seeds `DBState` + `selectedCharID`). DB fixtures in
  `__fixtures__/db/*.json`; expected snapshots in `expected/*.json`; upstream
  provider scripts in `upstream/*.jsonl`.
- **Snapshot harness** `src/ts/process/__fixtures__/snapshot.ts`
  (`recordStages`, `captureSnapshot`, `assertOrRecord` honoring `UPDATE_FIXTURES=1`).
- **Mock fetch / SSE** `src/ts/process/__fixtures__/mocks/`:
  - `serverChatFetch.ts` emulates `/generate/chat` as SSE; records calls
    (`getServerChatCalls`); scriptable via `setServerChatPrompt`/`…MessagePatch`/
    `…Info`/`…DispatchResult`/`…DispatchError`/`…SideEffects`/`…Error`; **any
    unexpected URL throws** (`:271-273`).
  - `serverCompletionFetch.ts` emulates `/generate/completion`; records
    `getServerCompletionCalls` incl. `authHeader`; unexpected URL throws (`:145-147`).
- **Flipping the gate in tests:** set `DBState.db.useServerPromptAssembly = true`
  on the seeded DB (e.g. `sendChat.serverPreview.test.ts:94`,
  `sendChat.fixtures.serverBacked.test.ts:508`), or seed it server-side
  (`generation.chat.test.ts:683`). The platform gate is the hoisted
  `platformState.isFastifyServer` + `vi.mock('../../platform')` getter.
- **Observing POSTs:** (a) `vi.stubGlobal('fetch', mock)` pushing into a `calls[]`
  getter; (b) the route-backed harness's own recording `fetch` →`app.inject`
  (`sendChat.fixtures.serverBacked.test.ts:414-456`); (c) a local
  `stubCommandFetch()` returning `CapturedFetch[]` (`command.projectionGuard.test.ts:49`).

**Adding a fixture** (e.g. "zero scriptstate POSTs", "local assembler
unreachable"): add `db/<name>.json` (+ `expected/<name>.json`; first run
auto-records and fails loudly), then add the name to `ROUTE_BACKED_CHAT_FIXTURES`
(`:165`) and filter the harness's recorded `/commands/*` calls. A "function is
unreachable" guarantee belongs in the **audit** (an A4-style rule), not a vitest
fixture; the test-side proxy for it is the throwing fetch stub +
`expect(getServerCompletionCalls()).toEqual([])` (`:732`).

## Per-batch proof shape

From [`../status/sendchat-thinning.md`](../status/sendchat-thinning.md#verification-coverage):
a chat-process batch should prove the exact mode; that the source branch is
removed/server-owned OR the send is classified `unsupported` (never a silent
local fallback); message-row effects; command revision + active-writer behavior
for any persisted mutation; SSE frames + terminal behavior; rollback; B1 effects
preserved; and that unsupported providers still hard-fail (A3). For **A1**: the
classifier returns `unsupported`/`server` (not `local`) and the local assembler
is unreachable for the subset. For **C-A1**: zero `patchChatScriptstate` POSTs for
an assembly-time var write, and a non-active-writer `/chat` does not persist.

## Audit (`util/client-thinning-audit.ts`)

23 checks registered in `auditChecks`, selectable by id via
`CLIENT_THINNING_AUDIT_CHECK_IDS`.

- **EC1 provider ownership — `checkProviderOwnership`** (`:1234`, registered
  `:2652`): the most chat-relevant rule. Pins literal needles in
  `serverCompletion.ts` — `"if (!isFastifyServer) return { type: 'local' }"`,
  the two "not supported in Fastify server mode" strings (`:1238-1242`) — plus
  google.ts gates and forbids `useServerGeneration` in the client settings map.
  `resolveServerPromptAssembly` has analogous needles so the Fastify flag-on path
  cannot silently regain local fallback.
- **A4R-pluginv2 no server-side plugin execution**: keeps pluginV2 edit/replacer
  hooks permanent unsupported by forbidding server prompt code from importing or
  executing the browser plugin runtime.
- **EC5 active-writer guard** (`:518`, registered `:2644`): classifies
  `/generate/chat` and `/generate/preview-prompt` as `active-writer`
  (`:387-400`) and requires the client `serverChat.ts` helper to carry the writer
  header + stale handling (`:617-627`).

### The four defeated rules hardened in phase 5

These were empirically defeated by sincere refactors and are now AST-backed
invariants with adversarial fixtures:

- **A4R2 — `checkAlpha4ConflictRetry`**: conflict-status comparisons are located
  structurally, with aliased string literals handled, and command replay in the
  conflict branch is detected.
- **A4R7 — `checkAlpha4AssetUrlGate`**: Fastify/browser branches are located by
  guard polarity and asset URL helper shapes are validated instead of relying on
  a `?? loc` text needle.
- **A4R-fanout — `checkAlpha4CompositeFanout`**: `.svelte` files now parse
  `<script>` blocks and markup event handlers into ts-morph before the same scope
  analysis used for `.ts` files.
- **EC2 — `checkPluginStorageGates`**: the sink set is derived from browser
  storage globals and `localforage.createInstance` declarations, so new
  device-local methods cannot bypass a fixed name list.

Remaining shallow string/regex rules are not automatically phase-5 work; the bar
for opening another hardening batch is a sincere defeat against the real audit
binary.

### Running the audit

- Entry point: `package.json` → `"client-thinning:audit": "tsx util/client-thinning-audit.ts"`.
  Exits 1 on any finding.
- Regression tests: `util/client-thinning-audit.test.ts` — **58 tests** over the
  23 checks, each spawning the real audit with a per-check `CLIENT_THINNING_AUDIT_CHECK_IDS`
  against a fixture. Fixtures in `util/client-thinning-audit-fixtures/<rule>/{failing*, *-bypass}/`
  (a failing fixture exits non-zero, a bypass fixture exits 0); some rules have
  multiple failing/adversarial fixtures, hence 58 > 23.

## Verification commands

`package.json` scripts (verbatim):

```
"test": "vitest run",
"client-thinning:audit": "tsx util/client-thinning-audit.ts",
"smoke:fastify-browser": "cross-env VITE_FASTIFY_BROWSER_SMOKE=TRUE VITE_RISU_LEGAL_CONFIGURED=TRUE pnpm buildsite && playwright test -c playwright.fastify-smoke.config.ts",
"api:test": "vitest run --config server/fastify/vitest.config.ts"
```

- `pnpm client-thinning:audit` — the 23-check audit (start here; if red, fix/triage
  before runtime work).
- `pnpm api:test` — server suite (incl. `generation.chat.test.ts`).
- `pnpm test` — full client suite (incl. `src/ts/process/...`).
- `pnpm smoke:fastify-browser` — build + Playwright smoke (long).
- Focused (the form the docs use):
  - `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts src/ts/process/request/tests/serverCompletion.test.ts` (the "163 tests" = 38 local fixtures + 125 classifier cases).
  - `pnpm exec vitest run util/client-thinning-audit.test.ts` (58 tests).
  - `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts src/ts/process/request/tests/serverChat.test.ts`.
  - `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts`.

After a recordable verification, replace
[`../latest-verification.md`](../latest-verification.md) with
the latest verification batch commands and results.
