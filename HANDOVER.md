# HANDOVER

Date: 2026-05-22
Branch: `fastify`
Head: `05a4e248 docs: backfill Phase 6-22 commit hash in next-steps.md`

This file is the working handover from the previous agent. Read
`docs/fastify/phases/phase-6-server-generation.md` for the phase
goal and `docs/fastify/status/next-steps.md` for the per-slice
history; this HANDOVER focuses on **what's queued next** so you
can pick it up without re-deriving context.

## Where things stand

Phase 6 has shipped a server-side `POST /api/v1/generate/completion`
route, the normalized SSE envelope, the client adapter, and the
dual-mode fixture sweep. The following provider mappings are
live:

- Vanilla wire formats: `echo`, `openai`, `nanogpt`, `openrouter`,
  `anthropic`, `mistral`, `cohere`, `gemini` (Studio + Vertex),
  `openai-legacy-instruct`, `openai-responses`, `kobold`,
  `ooba-legacy`, `ollama` (native `/api/chat`), `bedrock` (AWS
  SigV4), `horde` (async polling).
- Variant routings on existing dispatchers: AnthropicLegacy,
  NanoGPT Messages, NanoGPT Legacy, NanoGPT Responses, DeepSeek +
  DeepInfra (OAI-compat keyIdentifier), Ollama cloud
  (openai / openai-responses / anthropic per
  `db.ollamaRequestFormat`), `xcustom:::<id>` under
  OpenAICompatible **and** Anthropic, `reverse_proxy` under
  OpenAICompatible (with `risu::` header lift, URL autofill,
  `db.reverseProxyOobaMode` system hoisting) **and** Anthropic.

Shared server-side infrastructure that now exists:

- `additionalParams.ts` — body/header overlay DSL ported from the
  SPA (used by openai + anthropic dispatchers; ready to wire into
  other dispatchers when their reverse_proxy / xcustom slices
  land).
- `vertexAuth.ts` — RS256 JWT signing + in-process Bearer cache.
- `sigv4.ts` — pure-JS AWS SigV4 signer.
- `applyOobaSystemHoist` in `openai.ts` — system-message hoist
  for `db.reverseProxyOobaMode`.

Latest verification (Phase 6-22 closeout):

- `pnpm api:test`: 419 across 27 files
- `pnpm test`: 570 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: clean

The dual-mode fixture sweep still covers the original 7
fixtures (`echo-basic`, `openai-basic`, `anthropic-basic`,
`mistral-basic`, `cohere-basic`, `deepseek-basic`,
`gemini-basic`). Local sendChat sweep still covers 33 fixtures.

## What to do next

Three categories of work remain. All three are well-scoped; pick
based on appetite and risk tolerance.

### 1. Mechanical batch — extend additionalParams to other format dispatchers

`reverse_proxy` and `xcustom:::<id>` users can target any
`LLMFormat` via `db.customAPIFormat` / `customModels[].format`.
Today only OpenAICompatible and Anthropic are routed; Mistral,
Cohere, Gemini Studio, OpenAI Responses, OpenAI Legacy Instruct,
Kobold, ooba-legacy are all refused.

Each one follows the same recipe established by Phases 6-17
(xcustom OAI-compat) and 6-19 (Anthropic): port `additionalParams`
into the target dispatcher, drop the blanket refusal in the
adapter gate, add an autofill helper if the URL shape differs
from the wire's natural path.

Per-slice cost is small (~150 LOC + tests):

- **Mistral** (`reverse_proxy`/`xcustom` under `LLMFormat.Mistral`):
  Mistral's wire is OpenAI-compat-shaped, so URL autofill is
  same as OAI's `/v1/chat/completions`. The mistral dispatcher
  needs the same `buildRequestInit` consolidation we did for
  openai + anthropic.
- **Cohere** (`reverse_proxy`/`xcustom` under `LLMFormat.Cohere`):
  Cohere wire is `/chat` (no `/completions`). URL autofill helper
  needed.
- **OpenAI Responses** (`reverse_proxy`/`xcustom` under
  `LLMFormat.OpenAIResponseAPI`): wire path is `/responses`;
  autofill helper. Already accepts a `baseUrl` override.
- **OpenAI Legacy Instruct** (`reverse_proxy` under
  `LLMFormat.OpenAILegacyInstruct`): wire path is
  `/v1/completions`; autofill. Note that the SPA has an Ooba
  OAI-compat case too (see open question below).
- **Native Ollama**: probably skip — reverse_proxy onto a native
  Ollama server is an unusual config; xcustom can carry a custom
  baseUrl already.
- **Kobold / ooba-legacy**: same — these targets already accept
  an arbitrary baseUrl via their `options.kobold.baseUrl` /
  `options['ooba-legacy'].baseUrl`. A user who wants a
  reverse-proxied Kobold can configure it directly.

Recommended next: Mistral first (smallest), then Cohere, then
OpenAI Responses. The OpenAI Legacy Instruct one is entangled
with the Ooba memo decision (see below).

### 2. Other remaining gaps

- **Streaming for buffered-only providers**: Cohere, OpenAI Responses,
  OpenAI Legacy Instruct, Kobold, ooba-legacy, Bedrock, and Horde
  all ship buffered-only today. Each has its own reason (Cohere
  + legacy-instruct match local; Bedrock needs EventStream parser;
  Horde wire isn't incrementally streamable). The Bedrock
  EventStream parser is the most interesting follow-up: AWS
  EventStream is a binary length-prefixed framing protocol used
  by `:invoke-with-response-stream`. ~150 LOC for the parser +
  another ~100 LOC of wiring.
- **OpenAI MultiGen (`body.n = db.genTime`)**: deferred from
  reverse_proxy. Incompatible with the one-stream-per-completion
  SSE envelope as currently designed; would need a multi-result
  return shape.

### 3. Phase 7 prep — deferred prompt-assembly slices

Three providers were explicitly deferred to Phase 7 because they
all need server-owned character / user context to do their
prompt flatten properly:

- **Ooba OAI-compat** (`/v1/completions` against
  `db.textgenWebUIBlockingURL`). Memo:
  [`docs/fastify/design/ooba-oai-compat.md`](docs/fastify/design/ooba-oai-compat.md).
  Local uses `applyChatTemplate` (Jinja); routing through the
  existing `## User` flatten would silently change prompt format.
- **NovelAI + NovelList**. Memo:
  [`docs/fastify/design/novelai-novellist-stringlize.md`](docs/fastify/design/novelai-novellist-stringlize.md).
  Same shape — `stringlizeNAIChat` / `stringlizeAINChat` /
  `unstringlizeChat` need character + user state.

The Horde slice (6-22) used the option-B pattern from the
NovelAI memo: client pre-flattens via `applyChatTemplate`, ships
a `prompt` string, and unstringlizes the result client-side.
If the same pattern is acceptable for Ooba / NovelAI / NovelList,
those slices unblock immediately (~150 LOC each). Decision is
still open and worth raising with the user.

## Open questions for the user

If you keep going on Phase 6 without check-in, the safe picks are
the **mechanical batch** items above (Mistral / Cohere / OpenAI
Responses reverse_proxy + xcustom). They have no design
questions.

For the bigger decisions:

1. **Ooba / NovelAI / NovelList**: ship now using the Horde
   pattern (client pre-flattens + ships `prompt`), or defer to
   Phase 7 as the existing memos recommend?
2. **Bedrock streaming**: implement now (~250 LOC for the
   EventStream parser + plumbing) or defer until a fixture
   demands it?
3. **Phase 6 closeout**: is the current scope (15+ providers,
   shared infrastructure for additionalParams / SigV4 / Vertex
   JWT) enough to call Phase 6 done and move to Phase 7?

## Patterns to follow

When adding a provider, copy the structure from a similar recent
slice. The cleanest references:

- **OpenAI-compat wire shape**: copy `mistral.ts` (Phase 6-6).
- **New wire shape with streaming**: copy `gemini.ts` (Phase 6-9).
- **Non-streaming buffered-only**: copy `cohere.ts` (Phase 6-7).
- **Flat-prompt with flatten helper**: copy `openaiLegacyInstruct.ts`
  (Phase 6-10).
- **Variant routing of an existing dispatcher (no new code)**:
  Phase 6-11 anthropic-legacy / NanoGPT-messages is the smallest
  example.
- **additionalParams overlay through an existing dispatcher**:
  copy the openai (Phase 6-17) or anthropic (Phase 6-19) work.
- **reverse_proxy with URL autofill**: copy Phase 6-18 (OAI-compat)
  or 6-19 (Anthropic).
- **JWT auth + token cache**: copy `vertexAuth.ts` (Phase 6-20).
- **SigV4 / new pure-JS crypto**: copy `sigv4.ts` (Phase 6-21).
- **Async polling loop with abort cleanup**: copy `horde.ts`
  (Phase 6-22).

The dispatcher tests live in `server/fastify/__tests__/` (one
file per dispatcher). The route-level test cases append to
`server/fastify/__tests__/generation.completion.test.ts`. The
adapter test cases (format-map + buildProviderOptions + gate
refusals) go in `src/ts/process/request/tests/serverCompletion.test.ts`.

If a slice adds a dual-mode fixture, follow Phase 6-9's pattern
(`gemini-basic`): the fixture JSON can include an
`injectedModels` field that `loadFixture.ts` pushes into
`LLMModels` for the test only.

## Commit convention

Each slice gets its own commit. Use `feat:` prefix for code,
`docs:` for docs-only. Trailer:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

After a slice lands, update `docs/fastify/status/next-steps.md`:

1. Bump the "Immediate" item with current test counts and
   what's still uncovered.
2. Append a `Phase 6-XX` row to the "Landed Phase 6 Slices" table
   (mark `_pending_` first, then backfill the commit hash as a
   separate `docs:` commit).

## Slice numbering note

The original HANDOVER (`f33b15fb`) used 6-19 / 6-20 / 6-21 for
Vertex / AWS / Horde. Subsequent slices took those numbers
instead (6-16 native ollama through 6-22 horde). The
`docs/fastify/status/next-steps.md` table is authoritative for
current numbering; the pending task entries (#125-#127) still
carry historical labels but reflect completed work.
