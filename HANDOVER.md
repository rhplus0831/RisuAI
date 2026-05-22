# HANDOVER

Date: 2026-05-22
Branch: `fastify`
Head: `5c9d40fe docs: record Phase 6-10 through 6-14 slice summaries`

This file is the working handover from the previous agent. Read
`docs/fastify/phases/phase-6-server-generation.md` for the phase goal
and `docs/fastify/status/next-steps.md` for the per-slice history; this
HANDOVER focuses on **what's queued next** so you can pick it up
without re-deriving context.

## Where things stand

Phase 6 has shipped a server-side `POST /api/v1/generate/completion`
route, the normalized SSE envelope, the client adapter, and the
dual-mode fixture sweep. The following provider mappings are live:

- `echo`, `openai`, `nanogpt`, `openrouter`, `anthropic`, `mistral`,
  `cohere`, `gemini`, `openai-legacy-instruct`, `openai-responses`,
  `kobold`, `ooba-legacy`.
- Variant routings that ride existing dispatchers: AnthropicLegacy,
  NanoGPT Messages, NanoGPT Legacy, NanoGPT Responses, DeepSeek +
  DeepInfra (OAI-compat keyIdentifier), Ollama cloud (openai /
  openai-responses / anthropic per `db.ollamaRequestFormat`).

Latest verification (Phase 6-14 closeout):

- `pnpm api:test`: 295 across 21 files
- `pnpm test`: 526 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: clean

The dual-mode fixture sweep covers 7 fixtures (`echo-basic`,
`openai-basic`, `anthropic-basic`, `mistral-basic`, `cohere-basic`,
`deepseek-basic`, `gemini-basic`). Local sendChat sweep covers 33
fixtures.

## What to do next

There are two straightforward batches ready to land without design
questions, plus three slices that need a quick design check-in
before implementation. Land the two cheap batches first to keep
momentum, then bring the three open questions to the user.

### Straightforward batch A: Ooba OAI-compat + Native Ollama

Both follow the established slice pattern (server dispatcher → route
hook → client adapter format-map + buildProviderOptions branch →
dispatcher tests + 1-2 route tests + 1-2 adapter tests). Each is its
own commit.

**Slice 6-15: Ooba OAI-compat.** No new dispatcher — Ooba's modern
endpoint is `/v1/completions` (OpenAI Legacy Instruct wire shape) at
`db.textgenWebUIBlockingURL`. Route it through the existing
`provider: 'openai-legacy-instruct'` dispatcher with:

- `formatToServerProvider`: keep returning `null` for plain
  `LLMFormat.Ooba` (which means "old Ooba" — see Slice 6-16 below) and
  instead lift the routing inside `selectOpenAIVariant`-style logic.
  Actually the simpler placement: extend `formatToServerProvider` to
  return `'openai-legacy-instruct'` for `LLMFormat.Ooba` and add an
  `isOobaCompatible` gate that requires `db.textgenWebUIBlockingURL`
  to be set. The local code in `request.ts:839-908` builds the URL
  from that DB field.
- `buildProviderOptions['openai-legacy-instruct']`: when the source
  format is `LLMFormat.Ooba`, set `baseUrl = db.textgenWebUIBlockingURL`
  (the dispatcher already appends `/completions`; if the user's URL
  ends in `/v1` or already includes `/v1/completions` the existing
  endpoint() helper handles both — verify with a route test).
- No new fixture; the adapter test pinning the routing is sufficient.

Expected size: ~60 LOC of code (gate + options branch) + ~30 LOC of
tests.

**Slice 6-16: Native Ollama (`/api/chat`).** Own dispatcher because
the wire shape differs from openai-compatible. Look at
`src/ts/process/request/request.ts:1172-1278` for the local
implementation; the parts you need are the buffered branch
(`ollama.chat({model, messages, stream: false, think})`) plus the
streaming branch (`stream: true`) which yields `{message: {content,
thinking}}` chunks.

Recommended scope:

- New `server/fastify/src/generation/ollama.ts` with
  `resolveOllamaRequest`, `runOllama` (buffered) and `runOllamaStream`.
- Wire shape: `POST {baseUrl}/api/chat` with body
  `{model, messages: [{role, content}], stream, think?}`.
- The local code uses the `ollama` npm client. Server side, write
  a plain fetch dispatcher — that's lighter and matches the pattern
  established by other dispatchers in this phase. The streaming wire
  format is **NDJSON** (not SSE): each chunk is a JSON object on its
  own line, with a final `{done: true}` chunk. Parse line-by-line.
- Buffered response shape: `{message: {content, thinking?}, done:
  true, ...}`. Concatenate `content`; ignore `thinking` for the
  first cut (the local code renders it via
  `formatThinkingOutput` — defer that helper).
- Route hook: add `'ollama'` to SUPPORTED_PROVIDERS, dispatch
  ahead of openai-compat.
- Client adapter: `formatToServerProvider(LLMFormat.Ollama)` already
  returns `'ollama'` (Slice 6-13). The `resolveOllamaProvider` helper
  currently returns `null` for `aiModel === 'ollama-hosted'`; change
  it to return `'ollama'` (the new native provider tag) when
  `db.ollamaURL` is set. `buildProviderOptions.ollama` should emit
  `{baseUrl: db.ollamaURL, model: db.ollamaModel, think?}`.
- `resolveProviderModel('ollama', targ)` reads `db.ollamaModel` for
  ollama-hosted, `db.ollamaCloudModel` for ollama-cloud (already
  done).
- Streaming: yes, the Ollama NDJSON stream is straightforward —
  buffer until `\n`, JSON.parse, yield `{kind: 'token', content}`.
  Final chunk has `done: true` → yield `{kind: 'done',
  finishReason: 'stop'}`.

Expected size: ~220 LOC dispatcher + ~150 LOC tests + ~50 LOC route +
~40 LOC adapter.

### Straightforward batch B: NovelAI + NovelList

These need stringlize/unstringlize helpers ported from the local
code. They're individually substantial but follow the established
pattern. Read `src/ts/process/request/request.ts:582-697` for
NovelAI and `:1092-1170` for NovelList before starting.

**Slice 6-17: NovelAI.** New dispatcher. Wire shape:

- URL: `https://text.novelai.net/ai/generate` for kayra,
  `https://api.novelai.net/ai/generate` for clio (the local code
  branches on `aiModel === 'novelai_kayra'`).
- Auth: `Bearer ${db.novelai.token}`.
- Body: `{input: <flattened prompt>, model: 'kayra-v1' | 'clio-v1',
  parameters: {temperature, max_length, top_k, top_p, top_a,
  tail_free_sampling, repetition_penalty, ... full sampler block}}`.
  Look at the full payload in `request.ts:632-666`.
- Response: `{output: string}`. Run `unstringlizeChat(output,
  formated, charName)` on it.

Helpers you need to port:

- `stringlizeNAIChat(formated, charName, continueFlag)` — flatten
  chat into a single text prompt. The local source is in
  `src/ts/process/stringlize.ts` (verify path with grep).
- `unstringlizeChat(text, formated, charName)` — reverse-extract the
  assistant turn from the model's continuation.
- The whitespace-token-handling and the `repetition_penalty_whitelist`
  /  `bad_words_ids` arrays.

Out of scope for the first cut: `logit_bias_exp` (the local code builds
this from `arg.biasString` via `tokenizeNum` which uses the NovelAI
tokenizer; defer until needed). `NAIadventure` mode toggle. Server side
returns `{type: 'success', result: ...}` not `{type: 'multiline', ...}`.

Expected size: ~250 LOC dispatcher + ~150 LOC tests. Buffered only;
NovelAI doesn't stream text generation through `/ai/generate`.

**Slice 6-18: NovelList.** New dispatcher (or piggyback in
`novelai.ts` — your call). Wire shape:

- URL: `https://api.tringpt.com/api`.
- Auth: `Bearer ${db.novellistAPI}`.
- Body: `{text: stringlizeAINChat(...), length, temperature, top_p,
  top_k, rep_pen, top_a, rep_pen_slope, rep_pen_range, typical_p,
  badwords, model: 'damsel' | 'supertrin', stoptokens, logit_bias?,
  logit_bias_values?}`. Model picks based on `aiModel ===
  'novellist_damsel'`.
- Response: `{data: [text]}` (note the array). `unstringlizeAIN` to
  extract.

Helpers to port: `stringlizeAINChat`, `unstringlizeAIN`. Same
location guess as the NovelAI helpers.

Local code returns `{type: 'multiline', result}` but the Phase 6
server contract is `{type: 'success' | 'fail', result}` — the
multiline distinction is handled downstream on the SPA side.

Expected size: ~200 LOC dispatcher (or +120 if you stuff it into
`novelai.ts`) + ~120 LOC tests. Buffered only.

### Open questions — three auth-complex slices

These three slices each introduce a new infrastructure pattern. Bring
the questions to the user before writing code; each one is ~200-350
LOC and the design choice affects later maintenance.

**Slice 6-19: Vertex AI Gemini (JWT auth).**

The local code in `src/ts/process/request/google.ts:462-558` builds
a service-account assertion JWT using Web Crypto's `subtle.importKey`
+ `subtle.sign('RSASSA-PKCS1-v1_5')`, posts it to
`https://oauth2.googleapis.com/token` to exchange for a Bearer
access token, then hits `https://${region}-aiplatform.googleapis.com/
v1/projects/${PROJECT_ID}/locations/${region}/publishers/google/
models/${modelId}:generateContent`. Some Gemini 3 preview models are
only on the `global` endpoint; the local code special-cases
`/^gemini-3-.*-preview$/`.

**Questions to surface to the user:**

1. **Crypto lib**: Node `crypto.createSign('RSA-SHA256')` (Node
   standard, no deps) vs. importing a Web Crypto polyfill. The
   server already runs in Node so `crypto` is fine — preferred unless
   the user wants symmetry with the SPA's Web Crypto path.
2. **Token caching**: cache the issued Bearer (TTL ~1 hour from
   Google's response) in process memory keyed by service-account
   email? Avoids JWT-signing per request but adds a small cache
   structure.
3. **Auth field plumbing**: the SPA's `db.google.projectId` /
   `db.vertexRegion` / `db.google.clientEmail` (?) / `db.google.privateKey`
   pass through the request body in `options.gemini` like every
   other Phase 6 provider, or move them to a future server-side
   `auth` settings group (Phase 9)? Sticking with the body-pass
   pattern is consistent with the rest of Phase 6.

The Gemini dispatcher (`server/fastify/src/generation/gemini.ts`)
already has `endpoint(req, stream)` that builds the URL from
`baseUrl + /models/<model>:generateContent?key=<apiKey>`. The
Vertex variant needs:

- A different `endpoint()` shape (`/v1/projects/.../locations/.../
  publishers/google/models/<id>:generateContent`).
- A different auth (Bearer in `Authorization` header instead of the
  `?key=` query param).
- The JWT signing flow producing that Bearer.

You can either extend `gemini.ts` with a `mode: 'studio' | 'vertex'`
discriminant or create a parallel `vertexGemini.ts` that delegates the
request-body building to a shared helper. Either works.

Expected size: ~250 LOC including the JWT helper + token cache + the
Vertex URL builder + ~150 LOC of tests (some pinning the JWT shape).

**Slice 6-20: AWS Bedrock Claude (SigV4).**

The local code isn't in the repo for AWS — this is a fresh
implementation. AWS SigV4 is well-documented (see AWS's
[Authenticating Requests (Signature Version 4)](https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html)).

Wire flow:

- Endpoint: `https://bedrock-runtime.${region}.amazonaws.com/model/${modelId}/invoke`
  for buffered, `:invoke-with-response-stream` for streaming.
- Body: Anthropic Messages wire shape but with
  `anthropic_version: 'bedrock-2023-05-31'` (not the regular date).
- Auth: SigV4. Need `accessKeyId`, `secretAccessKey`, optional
  `sessionToken` (for STS-issued temporary creds), and `region`.
- Streaming wire format is **AWS EventStream** (not SSE) — a binary
  framing protocol. Each frame is length-prefixed and contains a
  payload with the Anthropic-shaped delta. This is the biggest
  unknown of the slice.

**Questions to surface to the user:**

1. **Streaming scope**: skip Bedrock streaming for the first cut (the
   `:invoke` non-streaming endpoint is plain JSON; only
   `:invoke-with-response-stream` uses EventStream)? That cuts ~150
   LOC and aligns with how Cohere shipped non-streaming-only in 6-7.
2. **SigV4 implementation**: pure-JS port of the canonical-request
   algorithm (~150 LOC of HMAC chaining) vs. pulling in
   `@aws-sdk/client-bedrock-runtime` (full AWS SDK, large bundle —
   probably not worth it on the server). The pure port is what every
   third-party client does and is straightforward.
3. **Credential plumbing**: same question as Vertex — pass via
   `options.bedrock = {accessKeyId, secretAccessKey, sessionToken?,
   region}` in the request body, or wait for the Phase 9 server-side
   auth store?

Expected size: ~350 LOC including a small SigV4 helper + body
mapping + ~200 LOC of tests (with one test pinning a known SigV4
signature against AWS's published reference examples for confidence).

**Slice 6-21: Stable Horde (async polling).**

The Stable Horde wire flow is fundamentally different from
request/response. Local browser code in `request.ts` (find
`requestHorde`) does:

1. `POST /v2/generate/text/async` with the prompt + sampler params,
   gets back `{id: 'job-uuid'}`.
2. Poll `GET /v2/generate/text/status/<id>` every few seconds until
   `done: true`.
3. Cancel via `DELETE /v2/generate/text/status/<id>`.

For the server, this means the request handler holds the polling loop
internally, and:

- Buffered mode: poll until done, then return `{type: 'success',
  result}` from the final status payload.
- Streaming mode: emit a `kind: 'token'` frame each poll-cycle as
  partial text appears, then `kind: 'done'` when complete.

**Questions to surface to the user:**

1. **Streaming scope**: emit progressive `kind: 'token'` frames per
   poll, or buffer the whole thing and emit one final token + done
   frame? The local code is non-streaming on the read side; the
   simpler-first-cut is to mirror that.
2. **Polling cadence**: 2 seconds matches the local code's default.
   Configurable per request, or hardcoded for the first cut?
3. **Timeout**: a job that never completes (worker exhausted, model
   crashed) needs a wall-clock limit. 5 minutes? Server-configurable?
4. **Client abort**: when the SPA aborts mid-poll, the server should
   fire `DELETE /v2/generate/text/status/<id>` so the Horde worker
   stops the job. Verify the existing `attachAbort` cleanup pattern
   handles this.

Expected size: ~200 LOC including the polling loop + abort hook +
~120 LOC of tests (using `vi.useFakeTimers` to advance polling).

## Patterns to follow

When adding a provider, copy the structure from a similar recent
slice. The cleanest references:

- **OpenAI-compat wire shape**: copy `mistral.ts` (Phase 6-6).
- **New wire shape with streaming**: copy `gemini.ts` (Phase 6-9).
- **Non-streaming buffered-only**: copy `cohere.ts` (Phase 6-7).
- **Flat-prompt with prompt-flattening helper**: copy
  `openaiLegacyInstruct.ts` (Phase 6-10).
- **Variant routing of an existing dispatcher (no new code)**: the
  Anthropic/NanoGPT-Messages routing in Phase 6-11 is the smallest
  example.

The dispatcher tests live in `server/fastify/__tests__/` (one file
per dispatcher). The route-level test cases append to
`server/fastify/__tests__/generation.completion.test.ts`. The adapter
test cases (format-map + buildProviderOptions + gate refusals) go in
`src/ts/process/request/tests/serverCompletion.test.ts`.

If the slice adds a dual-mode fixture, follow Phase 6-9's pattern
(`gemini-basic`): the fixture JSON can include an `injectedModels`
field that `loadFixture.ts` pushes into `LLMModels` for the test only.

## Commit convention

Each slice gets its own commit. Use `feat:` prefix. Footer:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

After the slice lands, append a `Phase 6-XX` entry to the top of
`docs/fastify/status/next-steps.md` under "Completed Slices" and
update the "Immediate" item with the current count of green tests
and what's still uncovered.
