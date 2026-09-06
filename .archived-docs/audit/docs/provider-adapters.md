# Provider request/response adapters (`PR`)

Fastify side: `server/fastify/src/generation/*`,
`server/fastify/src/prompt/chatDispatch.ts`. Original side:
`src/ts/process/request/*` (all `@71c476e9c`). See [README.md](README.md)
for baseline and format.

## Open findings

### PR-1 — Gemini safety overrides are omitted [high]

- **Verification:** code-verified (no `safetySettings` anywhere in the
  Fastify Gemini adapter)
- **Classification:** BUG
- **Fastify:** `server/fastify/src/generation/gemini.ts:240`
- **Original:** `src/ts/process/request/google.ts:285` `@71c476e9c`
- **Difference:** The original always sent `BLOCK_NONE` (or `OFF` for
  `geminiBlockOff` models) for the sexual/hate/harassment/dangerous/civic
  categories. Fastify sends no `safetySettings`, leaving provider defaults
  active.
- **Scenario:** Mature role-play through Gemini: the original disabled the
  block; Fastify may receive `SAFETY`, return no text, and fail.

### PR-2 — Gemini JSON-schema mode is not sent [high]

- **Verification:** cross-confirmed (two agents independently)
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/chatDispatch.ts:196`,
  `server/fastify/src/generation/gemini.ts:240`
- **Original:** `src/ts/process/request/google.ts:537` `@71c476e9c`
- **Difference:** JSON response formats are constructed only for OpenAI
  Chat/Responses. Gemini receives neither
  `response_mime_type: "application/json"` nor `response_schema`.
- **Scenario:** JSON Schema enabled with `{answer: string}` on Gemini:
  original constrains the model; Fastify requests plain text and extraction
  can fail.

### PR-3 — Gemini 3 thinking mapping and zero-top-k differ [high]

- **Verification:** cross-confirmed
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/chatDispatch.ts:278`,
  `server/fastify/src/generation/gemini.ts:214`
- **Original:** `src/ts/process/request/google.ts:328`, `:362`,
  `src/ts/process/request/shared.ts:188` `@71c476e9c`
- **Difference:** Fastify always sends `thinkingConfig.thinkingBudget`; the
  original mapped Gemini 3 budgets to `thinkingLevel` (Flash LOW/MEDIUM/HIGH,
  Pro LOW/HIGH) and removed the budget. Fastify also sends `topK: 0` where
  the original omitted top-k at zero.
- **Scenario:** `gemini-3-flash-preview`, 4096 thinking tokens, `top_k=0`:
  original sends `thinkingLevel: "MEDIUM"` with no `topK`; Fastify sends
  `thinkingBudget: 4096` and `topK: 0` — rejected, ignored, or sampled
  differently.

### PR-4 — Gemini reverse-proxy URL/headers/params are ignored [high]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/chatDispatch.ts:1282`
- **Original:** `src/ts/process/request/google.ts:546`, `:581` `@71c476e9c`
- **Difference:** `resolveGeminiRequest()` supports a Studio `baseUrl`, but
  dispatch never passes `providerOptions.baseUrl`, `extraHeaders`, or
  `additionalParams`. The original honored custom URL and reverse-proxy
  parameter overrides.
- **Scenario:** GoogleCloud-format reverse proxy with a custom URL and
  required header: original routes through the proxy; Fastify hits
  `generativelanguage.googleapis.com` and typically fails auth/routing.

### PR-5 — Gemini image/audio response modalities and assets are lost [high]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/generation/gemini.ts:240`, `:379`
- **Original:** `src/ts/process/request/google.ts:402`, `:720` `@71c476e9c`
- **Difference:** The original requested `TEXT,IMAGE`/`TEXT,AUDIO` for
  output-capable models, disabled streaming, and persisted returned
  `inlineData` as an inlay asset. Fastify sends no `responseModalities` and
  extracts only text/thought/function-call parts.
- **Scenario:** `Gemini Pro 3 Image Preview` asked to generate an image:
  original persists an `{{inlayeddata::...}}` marker; Fastify discards the
  image and can fail with "upstream returned no text content".

### PR-6 — OpenRouter `risu/free` is sent as a literal model ID [high]

- **Verification:** code-verified (`risu/free` has zero occurrences in
  `server/fastify/src/`; the sentinel is still selectable client-side)
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/chatDispatch.ts:726`
- **Original:** `src/ts/process/request/openAI/requests.ts:221`,
  `src/ts/model/openrouter.ts:139` `@71c476e9c`
- **Difference:** The original resolved the sentinel by fetching the
  OpenRouter catalog and selecting the free model with the largest context;
  Fastify passes the stored model string through unchanged.
- **Scenario:** Choose OpenRouter "Free Auto": the original sends a real
  `...:free` ID; Fastify sends `"model": "risu/free"` → invalid-model error.

### PR-7 — OpenRouter "Use Instruction Prompt" is ignored [high]

- **Verification:** agent-reported
- **Classification:** BUG (the settings UI still exposes and persists the
  toggle)
- **Fastify:** `server/fastify/src/prompt/chatDispatch.ts:1114`,
  `server/fastify/src/generation/openai.ts:188`
- **Original:** `src/ts/process/request/openAI/requests.ts:447` `@71c476e9c`
- **Difference:** The original removed `messages` and sent
  `prompt: applyChatTemplate(...)` when `useInstructPrompt` was enabled;
  Fastify always sends a `messages` array. Depends on the instruct-template
  engine (see PR-19).
- **Scenario:** Enabled with a Llama/ChatML template: original sends one
  rendered prompt string; Fastify sends role messages with different special
  tokens.

### PR-8 — Reverse-proxy Ooba request arguments are not forwarded [high]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/chatDispatch.ts:790`
- **Original:** `src/ts/process/request/openAI/requests.ts:493` `@71c476e9c`
- **Difference:** The profile resolver retains `reverseProxyOobaArgs`, but
  the OpenAI-compatible variant carries only `oobaSystemHoist`. The original
  merged every non-null Ooba argument into the outgoing body.
- **Scenario:** Ooba mode with `mode`, `tokenizer`, `top_k`,
  `repetition_penalty_range`, or `grammar_string` set in the still-live Ooba
  settings page: original sends them; Fastify silently omits them.

### PR-9 — `additionalParams` can desynchronize stream mode and parser [high]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/generation/openai.ts:251`
- **Original:** `src/ts/process/request/openAI/requests.ts:577` `@71c476e9c`
- **Difference:** Fastify applies `additionalParams` after setting
  `body.stream` and never restores the dispatch-selected value; the original
  reapplied the correct `stream` flag after custom parameters.
- **Scenario:** `stream=true` in a custom parameter list while UI streaming
  is off: Fastify requests SSE but invokes the buffered JSON parser →
  invalid-JSON failure (and the converse).

### PR-10 — Exact custom URLs with query strings are corrupted [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/chatDispatch.ts:336`,
  `server/fastify/src/generation/openai.ts:234`
- **Original:** `src/ts/process/request/openAI/requests.ts:518` `@71c476e9c`
- **Difference:** With URL autofill disabled the original used `customURL`
  verbatim; Fastify checks whether the whole string ends in
  `/chat/completions` and then unconditionally appends that path — a query
  string defeats the suffix match.
- **Scenario:** `https://host/v1/chat/completions?api-version=2025-01-01`
  becomes `...?api-version=2025-01-01/chat/completions`.

### PR-11 — DeepSeek embedded `<think>` output is not normalized [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/generation/openai.ts:379`, `:578`
- **Original:** `src/ts/process/request/openAI/requests.ts:707`, `:1295`
  `@71c476e9c`
- **Difference:** Structured `reasoning_content`/`reasoning` fields are
  normalized, but models flagged `deepSeekThinkingOutput` that embed
  reasoning in `<think>...</think>` are not extracted into the shared
  `<Thoughts>` envelope (buffered or streaming).
- **Scenario:** A DeepSeek-compatible model returns
  `<think>hidden</think>answer` with Strip CoT off: original persists the
  thoughts envelope; Fastify persists literal `<think>` tags.

### PR-12 — Cumulative stream fragments are duplicated [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/generation/openai.ts:568`
- **Original:** `src/ts/process/request/openAI/requests.ts:1172`, `:1230`
  `@71c476e9c`
- **Difference:** The original detected cumulative proxy fragments (incoming
  fragment starting with the accumulated text replaces rather than appends);
  Fastify treats every `delta.content` as append-only.
- **Scenario:** A proxy emits `Hel` then cumulative `Hello`: original ends
  with `Hello`; Fastify streams and persists `HelHello`.

### PR-13 — Anthropic stream errors can persist as successful output [high]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/generation/anthropic.ts:439`
- **Original:** `src/ts/process/request/anthropic.ts:834` `@71c476e9c`
- **Difference:** The Fastify SSE handler has no `error`-event branch: after
  partial text plus an `error` event and connection close, it emits `done`.
  The original recognized `type: "error"` payloads, surfaced the message, and
  triggered overload retry behavior. Fastify also accepts only `text_delta`,
  not the proxy-compatible `delta.type: "text"`.
- **Scenario:** HTTP 200 SSE with partial text then `overloaded_error`:
  original fails/retries; Fastify persists the partial text as a completed
  response.

### PR-14 — Anthropic image order and cache-marker placement changed [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/generation/providerMessages.ts:134`
- **Original:** `src/ts/process/request/anthropic.ts:147` `@71c476e9c`
- **Difference:** Fastify builds `[image A, image B, text]` and marks the
  final part for a new-row cache point; the original `unshift()`ed images
  (producing `[image B, image A, text]`) and marked `content[0]`.
- **Scenario:** Attach images A then B and ask Claude to compare "the first"
  and "the second": the provider sees opposite orders, and the caching
  boundary sits on a different part.

### PR-15 — Anthropic large-output beta header is no longer added [medium]

- **Verification:** agent-reported
- **Classification:** UNCLEAR — definite baseline drift, but the beta's
  current provider applicability may have changed; verify against the current
  Anthropic API before acting.
- **Fastify:** `server/fastify/src/generation/anthropic.ts:166`
- **Original:** `src/ts/process/request/anthropic.ts:589` `@71c476e9c`
- **Difference:** The original added `anthropic-beta: output-128k-2025-02-19`
  whenever `max_tokens > 8192`; Fastify adds only the one-hour cache beta.

### PR-16 — Bedrock Claude thinking configuration and output are dropped [high]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/chatDispatch.ts:1432`,
  `server/fastify/src/generation/bedrock.ts:129`, `:252`
- **Original:** `src/ts/process/request/anthropic.ts:351`, `:434`, `:512`
  `@71c476e9c`
- **Difference:** The Bedrock request type has no thinking fields and the
  parser keeps only text blocks. The original sent budget/adaptive thinking,
  forced temperature 1 and removed top-p/top-k when thinking was enabled, and
  preserved `thinking`/`redacted_thinking` blocks in `<Thoughts>`.
- **Scenario:** Bedrock Claude 3.7 with a 4096-token thinking budget:
  original runs extended thinking and persists the envelope; Fastify performs
  a non-thinking request and discards returned thinking blocks.

### PR-17 — Native Ollama thinking mode and thought text are ignored [high]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/chatDispatch.ts:1416`,
  `server/fastify/src/generation/ollama.ts:199`, `:333`
- **Original:** `src/ts/process/request/request.ts:1099`, `:1162`
  `@71c476e9c`
- **Difference:** The active `ollamaThinkingMode` option is never passed as
  `think`, and both parsers read only `message.content`. The original mapped
  the mode and combined `message.thinking` with content in the shared
  thoughts format.
- **Scenario:** Reasoning-capable Ollama model with thinking `medium`:
  original sends `think: "medium"` and persists `<Thoughts>`; Fastify omits
  the control and drops `message.thinking`.

### PR-18 — Kobold/Ooba-legacy/Horde lose non-ChatML instruct templates [high]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/generation/openaiLegacyInstruct.ts:57`,
  `server/fastify/src/generation/kobold.ts:37`,
  `server/fastify/src/generation/oobaLegacy.ts:75`,
  `server/fastify/src/prompt/chatDispatch.ts:927`
- **Original:** `src/ts/process/request/request.ts:656`, `:958`, `:1353`,
  `src/ts/process/templates/chatTemplate.ts:27` `@71c476e9c`
- **Difference:** Kobold and Ooba adapters reuse a fixed
  `## User/Instruction/Response` flattener; Horde supports only ChatML/GPT2
  and otherwise emits generic `role: content`. The original ran all three
  through the full template engine (Llama 2/3, Gemma, Mistral, Vicuna,
  Alpaca, custom Jinja).
- **Scenario:** Llama 3 template with a Kobold/Ooba/Horde backend: original
  emits Llama 3 control tokens; Fastify sends `##` headings or role labels.

### PR-19 — Ooba legacy loses default stop strings and cleanup [high]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/chatDispatch.ts:1375`,
  `server/fastify/src/generation/oobaLegacy.ts:146`, `:227`
- **Original:** `src/ts/process/request/request.ts:645`, `:758` `@71c476e9c`
- **Difference:** Without custom `localStopStrings`, Fastify omits
  `stopping_strings` (the original used `getStopStrings(false)`); it returns
  generated text without `unstringlizeChat` cleanup; and it sets
  `truncation_length` to `maxContext` where the original used the request's
  output-token argument.
- **Scenario:** No custom stops, `maxContext=8192`, `maxResponse=512`, Ooba
  generates `answer\nAlice: next turn`: original stops/trims before
  `Alice:` and sends truncation length 512; Fastify persists the extra
  simulated turn.

### PR-20 — Horde cleanup uses the first stored character [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/chatDispatch.ts:1468`
- **Original:** `src/ts/process/request/request.ts:1337`, `:1425`
  `@71c476e9c`
- **Difference:** Fastify passes `db.characters?.[0]?.name` to
  `unstringlizeChat`; the original used `getCurrentCharacter()`.
- **Scenario:** Alice is first in the collection but the active chat is Bob;
  Horde returns `reply\nBob: another turn`: original trims at `Bob:`;
  Fastify searches for `Alice:` and persists the unwanted continuation.

### PR-21 — Strong-ban logit bias has different token semantics [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/chatDispatch.ts:238`
- **Original:** `src/ts/process/request/openAI/requests.ts:191`,
  `src/ts/tokenizer.ts:494` `@71c476e9c`
- **Difference:** For bias `-101`, Fastify tokenizes case/space/newline
  variants and bans every token of each variant; the original created
  punctuation-adjacent variants and biased only their first non-punctuation
  token. Fastify also clamps ordinary bias values to `[-100,100]` where the
  original forwarded stored values unchanged.
- **Scenario:** Strong-ban `New York`: Fastify can ban `New` and `York`
  independently in unrelated text; the original primarily blocked
  phrase-start variants.

## Confirmed intentional divergences (no work items)

- **Tool execution is browser-owned rounds** rather than the original
  automatic provider loop. Documented in
  `docs/structure/providers-and-models.md:621-637`.
- **Native Ollama forwards sampler/output options** (`num_predict`,
  `temperature`, `top_p`, `top_k`) that the baseline omitted. Documented in
  the adapter and `docs/structure/providers-and-models.md:563`.
- **Missing adapters** — NovelAI text, NovelList, non-legacy Ooba,
  plugin-defined providers, and WebLLM are non-server-routable by design
  (`src/ts/process/request/providerCapability.ts:133-144`,
  `docs/structure/providers-and-models.md:782-790`).
- **Bedrock remains buffered** (the baseline also had no AWS EventStream
  streaming); Mistral becoming incremental is a transport-timing change with
  equivalent final text.

## Areas verified clean

Standard ×100 temperature and frequency/presence-penalty scaling with
`-1000` omission (outside PR-21); OpenAI message filtering, developer/name
fields, multimodal ordering/quality, assistant prefill, completion-token
naming, seed gating, multi-generation `n`, structured reasoning-field
extraction; OpenRouter fallback/middle-out/provider-order mapping; Anthropic
system extraction, alternate-role merging, leading-user enforcement,
text/thinking envelope, one-hour cache header; Gemini system-instruction
placement, same-role squashing, image-input encoding, Vertex URL/auth,
thought-stream suppression; OpenAI Responses input/output mapping, JSON
format, reasoning extraction, web-search tool insertion; Mistral and Cohere
basic mapping; Kobold/Horde numeric sampler scaling; `apiMetadata.ts`
omissions are diagnostic-only.
