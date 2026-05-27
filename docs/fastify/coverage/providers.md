# Provider Tests

Date: 2026-05-27

Status: Phase 6 completion routing closed in Phase 6-28
(`398a3ae6`; hash backfilled by `a8cb123b`). The table below
tracks the current implementation matrix and the remaining
no-port provider families. Post-closeout streaming error handling
closed in follow-up slices 6A-6C.

## Required per provider

For each provider that lands in `/api/v1/generate/completion`:

- Happy path: request shaping matches upstream contract.
- Streaming-capable providers: chunks normalized into the SSE
  envelope. Buffered-only providers document and test their
  `stream: true` rejection.
- Error: buffered upstream 4xx / 5xx maps to a documented failure.
  Streaming upstream failures emit typed `provider_error` SSE frames or
  fail before SSE headers when the failure is synchronous.
- Abort: client disconnect aborts upstream within ~1s.
- Headers: API key sourced from the same database setting the
  current browser request path uses; never echoed in upstream body
  or SSE frames.

## Provider inventory

This table mirrors the current `LLMProvider` / `LLMFormat` surface
in `src/ts/model/types.ts`, `src/ts/model/modellist.ts`, and
`src/ts/process/request/request.ts`.

| Provider / format family                | Request shape                             | Stream | Status      |
| --------------------------------------- | ----------------------------------------- | ------ | ----------- |
| Echo developer provider                 | deterministic echo                        | SSE envelope | covered by `echo.test.ts`, `generation.completion.test.ts`, and dual-mode fixture `echo-basic` |
| OpenAI Chat Completions                 | `/v1/chat/completions`                    | SSE    | covered by `openai.test.ts`, `generation.completion.test.ts`, and dual-mode fixture `openai-basic` |
| OpenRouter                              | Chat Completions-compatible with OpenRouter headers | SSE | covered by `generation.completion.test.ts`, `openai.test.ts`, and `serverCompletion.test.ts` |
| NanoGPT chat                            | Chat Completions-compatible, including subscription endpoint and optional `X-Provider` | SSE | covered by `generation.completion.test.ts`, `openai.test.ts`, and `serverCompletion.test.ts` |
| DeepSeek / DeepInfra keyIdentifier path | Chat Completions-compatible with configured key + endpoint | SSE | covered by `generation.completion.test.ts`, `serverCompletion.test.ts`, and dual-mode fixture `deepseek-basic` |
| OAI-compatible `xcustom:::`             | User-configured `/chat/completions` URL + key with `additionalParams` overlay | SSE | covered by `additionalParams.test.ts`, `openai.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| OAI-compatible `reverse_proxy`          | URL autofill, `risu::` header lift, `reverseProxyOobaMode`, and `additionalParams` overlay | SSE | covered by `openai.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| Anthropic Messages                      | `/v1/messages`                            | SSE    | covered by `anthropic.test.ts`, `generation.completion.test.ts`, and dual-mode fixture `anthropic-basic` |
| Anthropic legacy / NanoGPT Messages     | Messages-compatible via Anthropic or NanoGPT base URL | SSE | covered by `anthropic.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| Anthropic `xcustom:::` / `reverse_proxy` | `/v1/messages` URL autofill with shared `additionalParams` overlay | SSE | covered by `anthropic.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| Mistral                                 | Mistral chat                              | SSE    | covered by `mistral.test.ts`, `generation.completion.test.ts`, and dual-mode fixture `mistral-basic` |
| Mistral `xcustom:::` / `reverse_proxy`  | Mistral chat with URL autofill, `risu::` header lift, and `additionalParams` overlay | SSE | covered by `mistral.test.ts`, `generation.completion.test.ts`, `serverCompletion.test.ts`, and dual-mode fixture `mistral-reverse-proxy-basic` |
| Cohere                                  | Cohere chat                               | no; buffered only | covered by `cohere.test.ts`, `generation.completion.test.ts`, and dual-mode fixture `cohere-basic` |
| Cohere `xcustom:::` / `reverse_proxy`   | Cohere `/v1/chat` URL autofill with `additionalParams` overlay | no; buffered only | covered by `cohere.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| Gemini / Google AI                      | `generateContent` / `streamGenerateContent` | SSE | covered by `gemini.test.ts`, `generation.completion.test.ts`, and dual-mode fixture `gemini-basic` |
| Vertex AI Gemini                        | Gemini route with service-account JWT Bearer exchange | SSE | covered by `gemini.test.ts`, `vertexAuth.test.ts`, `generation.completion.test.ts`, `serverCompletion.test.ts`, and dual-mode fixture `gemini-vertex-basic` |
| OpenAI legacy instruct                  | `/v1/completions` prompt string           | no; buffered only | covered by `openaiLegacyInstruct.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| OpenAI legacy instruct `xcustom:::` / `reverse_proxy` | `/v1/completions` URL autofill with `additionalParams` overlay | no; buffered only | covered by `openaiLegacyInstruct.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| NanoGPT legacy                          | NanoGPT `/v1/completions` variant         | no; buffered only | covered by `openaiLegacyInstruct.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| OpenAI Responses API                    | `/v1/responses`                           | no; buffered only | covered by `openaiResponses.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| OpenAI Responses `xcustom:::` / `reverse_proxy` | `/v1/responses` URL autofill with `additionalParams` overlay | no; buffered only | covered by `openaiResponses.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| NanoGPT Responses                       | NanoGPT Responses variant                 | no; buffered only | covered by `openaiResponses.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| Ollama Cloud                            | Cloud OpenAI / Responses / Anthropic format selected by `db.ollamaRequestFormat` | provider-dependent | adapter covered by `serverCompletion.test.ts`; dispatch reuses OpenAI / Responses / Anthropic tests |
| Native Ollama                           | `/api/chat`                               | NDJSON normalized to SSE | covered by `ollama.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| Kobold                                  | `/api/v1/generate`                        | no; buffered only | covered by `kobold.test.ts` and `generation.completion.test.ts` |
| ooba / text-generation-webui legacy     | blocking `/api/v1/generate` endpoint      | no; buffered only | covered by `oobaLegacy.test.ts` and `generation.completion.test.ts` |
| AWS Bedrock Claude                      | Bedrock runtime Anthropic Messages payload with SigV4 | no; buffered only | covered by `bedrock.test.ts`, `sigv4.test.ts`, `generation.completion.test.ts`, `serverCompletion.test.ts`, and dual-mode fixture `bedrock-basic` |
| Stable Horde text                       | `/v2/generate/text/async` submit + status polling | no; buffered poll loop | covered by `horde.test.ts`, `generation.completion.test.ts`, `serverCompletion.test.ts`, and dual-mode fixture `horde-basic` |
| OpenAI-compatible fixed endpoint without keyIdentifier | User endpoint with no defined key lookup | no-port | client gate refuses until the auth path is defined |
| Gemini `reverse_proxy` / `xcustom:::` and other unproven custom formats | Provider-specific variants without a routed auth / request-shape slice | no-port | reopen only with a concrete fixture and route design |
| NovelAI text                            | NovelAI text-generation API               | no-port | see `../design/novelai-novellist-stringlize.md` |
| NovelList                               | NovelList API                             | no-port | see `../design/novelai-novellist-stringlize.md` |
| ooba OAI-compatible                     | `/v1/completions` with Jinja chat template flattening | no-port | see `../design/ooba-oai-compat.md` |

No-port provider/effect categories should return a documented `501`
from the server route when they are addressed by a server route:

- Plugin legacy providers - plugin code execution stays in the
  browser sandbox.
- WebLLM and Hugging Face `hf:::` models - in-browser models.
- transformers.js image embedding - browser ML.
- Browser Web Speech, VoiceVox, Vits, GPT-SoVITS, and Fish Speech -
  no-port TTS effects.

## No-port helper providers

| Endpoint                             | Providers                            | Status      |
| ------------------------------------ | ------------------------------------ | ----------- |
| `POST /api/v1/generate/translate`    | DeepL, DeepLX, Google free / HTML, Bergamot, LLM | no route in current Fastify surface |
| `POST /api/v1/generate/tts`          | OpenAI, ElevenLabs, NovelAI, Hugging Face API Inference | no route in current Fastify surface |
| `POST /api/v1/generate/image`        | WebUI, NovelAI, Stability, fal, ComfyUI / legacy Comfy, Imagen, OpenAI-compatible image, WaveSpeed, kei | no route in current Fastify surface |
| `POST /api/v1/generate/count-tokens` | tiktoken, Mistral, NovelAI, Claude, Llama / Llama 3, NovelList, Gemma, Cohere, DeepSeek / DeepSeek V4, GLM4 / GLM5 | no route in current Fastify surface |

## Reference

- `move-to-fastify/server/fastify/src/generation.ts` and the
  per-provider commits (`648fe0fb`-`5034ff42`) are the worked
  examples for each upstream's quirks.
- `risuai-metatron/server-py/tests/test_generation_provider_*.py`
  is the closest test pattern at scale.
