# sendChat orchestration, retries, and post-generation (`OR`)

Fastify side: `server/fastify/src/routes/generationChat.ts`,
`server/fastify/src/prompt/chatDispatch.ts`, post-generation in
`server/fastify/src/prompt/assemble.ts`, and the browser stages in
`src/ts/process/postGeneration/` and `src/ts/process/serverBackedSendChat.ts`.
Original side: the full `sendChat` in `src/ts/process/index.svelte.ts` and
retry/fallback logic in `src/ts/process/request/request.ts`
(all `@71c476e9c`). See [README.md](README.md) for baseline and format.

## Open findings

### OR-1 — IGP races the server terminal patch [high]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `src/ts/process/postGeneration/orchestrateResponse.ts:209`,
  `src/ts/process/index.svelte.ts:498`,
  `src/ts/process/postGeneration/igp.ts:28`,
  `src/ts/process/serverBackedSendChat.ts:686`
- **Original:** `src/ts/process/index.svelte.ts:1693`, `:1726` `@71c476e9c`
- **Difference:** The original ran `editoutput`, run-vars, the output
  trigger, and inlay processing before appending the IGP result. Fastify
  evaluates IGP while the browser still holds the raw streamed projection,
  before the server terminal patch containing derived `finalText`; the IGP
  message update is based on raw-plus-IGP text and races the terminal
  replacement.
- **Scenario:** Provider returns `foo`, `editoutput` maps it to `bar`, IGP
  returns `!`: original persists `bar!`; Fastify can persist `foo!`
  (accepted replay) or lose `!` (stale command).

### OR-2 — Empty "say nothing" sends now activate input hooks [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/assemble.ts:884`, `:997`, `:2113`
- **Original:** `src/lib/ChatScreens/DefaultChatScreen.svelte:170`
  `@71c476e9c`
- **Difference:** The original appended the synthetic `*says nothing*` text
  without running the `input` trigger or `editinput`; Fastify receives the
  row as an ordinary send and unconditionally runs both.
- **Scenario:** `useSayNothing` with an input trigger that increments a
  variable and an `editinput` rule matching the synthetic text: original
  sends it untouched with no variable write; Fastify changes both.

### OR-3 — Request-trigger rewrites reset between retries [medium]

- **Verification:** cross-confirmed (two agents; classification disputed —
  one judged the original accumulation itself an accident)
- **Classification:** UNCLEAR — `docs/structure/providers-and-models.md:700`
  and `server/fastify/__tests__/generation.chat.test.ts:6220` pin that the
  trigger runs per attempt, but neither specifies whether input rows reset.
- **Fastify:** `server/fastify/src/routes/generationChat.ts:328`
- **Original:** `src/ts/process/request/request.ts:222` `@71c476e9c`
- **Difference:** Fastify clones `baseRows` fresh for every retry; the
  original reset rows only when entering a fallback model, so same-model
  retries re-applied the trigger to already-transformed rows.
- **Scenario:** A request trigger appends `[attempt]` to row 0; first call
  fails pre-stream: the original's second attempt sends
  `prompt[attempt][attempt]`; Fastify sends `prompt[attempt]`.

### OR-4 — Provider-declared non-retryable failures are retried [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/routes/generationChat.ts:353`,
  `server/fastify/src/generation/kobold.ts:105`,
  `server/fastify/src/generation/horde.ts:295`
- **Original:** `src/ts/process/request/request.ts:315`, `:1002`, `:1419`
  `@71c476e9c`
- **Difference:** The original result contract had `noRetry` (set by Kobold
  HTTP failures and impossible/empty Horde jobs) causing immediate failure.
  Fastify provider frames have no equivalent, so every pre-token error runs
  through the full retry budget and fallbacks.
- **Scenario:** Kobold returns an auth-related 4xx with `requestRetrys=5`:
  original makes one request; Fastify sends it six times, then may try
  fallbacks.

### OR-5 — Retry counts above ten are silently reduced [low]

- **Verification:** agent-reported
- **Classification:** BUG (UI accepts up to 20; the server clamps to 10)
- **Fastify:** `server/fastify/src/routes/generationChat.ts:237`,
  `src/ts/setting/advancedSettingsData.ts:75`
- **Original:** `src/ts/process/request/request.ts:330` `@71c476e9c`
- **Difference:** The original used the configured value unclamped.

### OR-6 — Buffered Continue no longer performs the two-pass `editoutput` [medium]

- **Verification:** agent-reported
- **Classification:** UNCLEAR — the original double execution looks
  accidental; parity would deliberately re-introduce a double side effect.
- **Fastify:** `server/fastify/src/prompt/assemble.ts:2685`
- **Original:** `src/ts/process/index.svelte.ts:1631` `@71c476e9c`
- **Difference:** For a non-stream Continue, the original called
  `editoutput` on the raw continuation at the prospective append index,
  discarded that text, then called it again on existing-plus-continuation at
  the assistant index. Fastify combines first and invokes it once.
- **Scenario:** A Lua `editOutput` incrementing a chat variable runs twice
  per buffered Continue in the original, once on Fastify.

### OR-7 — Continue can leave a stale reroll candidate [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/routes/generationChat.ts:2630`, `:2653`,
  `server/fastify/src/messageStore.ts:383`
- **Original:** `src/lib/ChatScreens/DefaultChatScreen.svelte:209`, `:245`
  `@71c476e9c`
- **Difference:** A Continue write replaces the same-UID row, so the
  pre-continue row comes back as `displaced` and is treated as a reroll
  candidate even though the store's own contract calls send/continue a clear
  boundary; UID dedup then keeps the stale pre-continue JSON. The original
  cleared the reroll buffer on Continue.
- **Scenario:** Assistant `A`, Continue to `A+B`, reload, regenerate:
  original preserves `A+B` as the old candidate; Fastify can preserve stale
  `A`, so swiping back loses the continuation.

### OR-8 — Buffered TTS speaks raw text and only the primary choice [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/providerTransport.ts:77`,
  `server/fastify/src/routes/generationChat.ts:2158`,
  `src/ts/process/serverBackedSendChat.ts:698`
- **Original:** `src/ts/process/index.svelte.ts:1644`, `:1683` `@71c476e9c`
- **Difference:** The TTS side effect is created from raw accumulated
  provider text before post-generation; the original spoke the
  post-`editoutput`, post-inlay result and called TTS once per
  multi-generation choice.
- **Scenario:** Streaming off, provider `foo`, `editoutput` → `bar`, auto
  TTS on: original displays and speaks `bar`; Fastify displays `bar` but
  speaks `foo`. With three choices the original speaks all three.

### OR-9 — Persisted `generationInfo` labels and timing fields differ [low]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/routes/generationChat.ts:253`, `:946`,
  `src/ts/process/postGeneration/stage4Finalize.ts:22`
- **Original:** `src/ts/process/models/modelString.ts:3`,
  `src/ts/process/index.svelte.ts:1470`, `:1738` `@71c476e9c`
- **Difference:** Fastify overwrites the legacy display label with raw
  `profile.requestModel || modelId` on success (OpenRouter/reverse-proxy/
  NanoGPT/Ollama lose their prefixes/friendly names), and server persistence
  happens before browser stage 4, leaving `stageTiming.stage2/stage4` at
  zero with no follow-up persistence command.
- **Scenario:** OpenRouter `anthropic/claude-x`, then reload/export:
  original metadata says `openrouter-anthropic/claude-x` with completed
  stage timings; Fastify persists `anthropic/claude-x` with zeroed stages.

## Confirmed intentional divergences (no work items)

- **A Lua edit-output failure falls back to raw provider text** and skips
  the remaining regex/run-var/output-trigger stages. Pinned by
  `server/fastify/__tests__/generation.chat.test.ts:4676`.
- **Group-chat generation is a hard no-port.** Documented in
  `docs/structure/providers-and-models.md:788`.
- **Streaming `editoutput` runs once at finalization; cancellation persists
  accumulated raw text.** Pinned by
  `server/fastify/__tests__/generation.chat.test.ts:3712`/`:3442`; documented
  in `docs/structure/data-and-events.md:241`.
- **Stream-failure boundaries changed** — retries only before the first
  token; post-token failure restores the pre-generation transcript instead
  of retaining partial text. Pinned by
  `server/fastify/__tests__/generation.chat.test.ts:5013`/`:6337`; documented
  in `docs/structure/providers-and-models.md:700`.
- **Legacy fallback lists run primary-first** (the baseline skipped the
  nominal primary when a fallback list existed). Pinned by
  `server/fastify/__tests__/generation.chat.test.ts:6220`.
- **Banned-script and blank-response policies buffer and inspect streaming
  results.** Pinned by `server/fastify/__tests__/generation.chat.test.ts:6220`/`:6302`;
  documented in `docs/structure/providers-and-models.md:703`.
- **Buffered Continue keeps the same row identity/metadata** instead of
  replacing with a new generation row. Pinned by
  `server/fastify/__tests__/generation.chat.test.ts:4485`.
- **Multi-generation alternates are processed in isolated cloned state**
  (only the primary's side effects persist). Explicit in
  `server/fastify/src/prompt/assemble.ts:2273`; pinned by
  `server/fastify/__tests__/generation.chat.test.ts:3725`; documented in
  `docs/structure/providers-and-models.md:705`.
- **Automatic continuation (`autoContinueChat`) was removed** by commit
  `5b751fcbe` ("one user click = one append").

## Areas verified clean

Ordinary send ordering (input trigger → append user row → `editinput` →
run-vars); start-trigger placement, stop-sending, additional-system-prompt
placement; Continue prompt assembly and `[Continue the last response]`
gating; successful finalization order (`editoutput` → insertion/extension →
run-vars → output trigger → persistence); multi-generation eligibility;
alternate-greeting selection and `fmIndex`; persisted row shape (`role`,
`saying`, numeric `time`, prompt info, generated ID); `otherUser`/alternate
JSON round-tripping; regenerate state reuse; pre-token failures persist no
assistant row; Escape Output unescape/escape semantics; the `5f4109fee` fix.
