# Provider Tests

Date: 2026-05-22

Status: Phase 6 is active. The server-backed completion route has
landed provider slices through Phase 6-14 (`f6b88f01`). The table
below tracks the current implementation matrix and the remaining
local-only provider families.

## Required per provider

For each provider that lands in `/api/v1/generate/completion`:

- Happy path: request shaping matches upstream contract.
- Streaming-capable providers: chunks normalized into the SSE
  envelope. Buffered-only providers document and test their
  `stream: true` rejection.
- Error: upstream 4xx / 5xx maps to a documented error frame.
- Abort: client disconnect aborts upstream within ~1s.
- Headers: API key sourced from the same database setting the
  current browser request path uses; never echoed in upstream body
  or SSE frames.

## Provider inventory

This table mirrors the current `LLMProvider` / `LLMFormat` surface
in `src/ts/model/types.ts`, `src/ts/model/modellist.ts`, and
`src/ts/process/request/request.ts`.

| Provider / format family               | Request shape                             | Stream | Status      |
| -------------------------------------- | ----------------------------------------- | ------ | ----------- |
| Echo developer provider                | local deterministic echo                  | SSE envelope | covered by `echo.test.ts`, `generation.completion.test.ts`, and dual-mode fixture `echo-basic` |
| OpenAI Chat Completions                | `/v1/chat/completions`                    | SSE    | covered by `openai.test.ts`, `generation.completion.test.ts`, and dual-mode fixture `openai-basic` |
| OpenRouter                             | Chat Completions-compatible via `https://openrouter.ai/api/v1` with `X-Title` + `HTTP-Referer` | SSE | covered by `generation.completion.test.ts`, `openai.test.ts`, and `serverCompletion.test.ts` |
| NanoGPT chat                           | Chat Completions-compatible via `https://nano-gpt.com/api/v1` or subscription endpoint, optional `X-Provider` | SSE | covered by `generation.completion.test.ts`, `openai.test.ts`, and `serverCompletion.test.ts` |
| Anthropic Messages                     | `/v1/messages`                            | SSE    | covered by `anthropic.test.ts`, `generation.completion.test.ts`, and dual-mode fixture `anthropic-basic` |
| Anthropic legacy / NanoGPT Messages    | Messages-compatible via Anthropic or NanoGPT base URL | SSE | covered by `anthropic.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| Mistral                                | Mistral chat                              | SSE    | covered by `mistral.test.ts`, `generation.completion.test.ts`, and dual-mode fixture `mistral-basic` |
| Cohere                                 | Cohere chat                               | no; buffered only | covered by `cohere.test.ts`, `generation.completion.test.ts`, and dual-mode fixture `cohere-basic` |
| Gemini / Google AI                     | `generateContent` / `streamGenerateContent` | SSE | covered by `gemini.test.ts`, `generation.completion.test.ts`, and dual-mode fixture `gemini-basic` |
| DeepSeek / DeepInfra keyIdentifier path | Chat Completions-compatible with configured key + endpoint | SSE | routes through the OpenAI dispatcher; covered by `generation.completion.test.ts`, `serverCompletion.test.ts`, and dual-mode fixture `deepseek-basic` |
| OpenAI legacy instruct                 | `/v1/completions` prompt string           | no; buffered only | covered by `openaiLegacyInstruct.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| NanoGPT legacy                         | NanoGPT `/v1/completions` variant         | no; buffered only | covered by `openaiLegacyInstruct.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| OpenAI Responses API                   | `/v1/responses`                           | no; buffered only | covered by `openaiResponses.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| NanoGPT Responses                      | NanoGPT Responses variant                 | no; buffered only | covered by `openaiResponses.test.ts`, `generation.completion.test.ts`, and `serverCompletion.test.ts` |
| Ollama Cloud                           | Cloud OpenAI / Responses / Anthropic format selected by `db.ollamaRequestFormat` | provider-dependent | adapter covered by `serverCompletion.test.ts`; dispatch reuses OpenAI / Responses / Anthropic tests |
| Kobold                                 | `/api/v1/generate`                        | no; buffered only | covered by `kobold.test.ts` and `generation.completion.test.ts` |
| ooba / text-generation-webui legacy    | blocking `/api/v1/generate` endpoint      | no; buffered only | covered by `oobaLegacy.test.ts` and `generation.completion.test.ts` |
| OpenAI-compatible custom / reverse proxy / xcustom | User endpoint without the keyIdentifier contract | local only | client gate still refuses these server-backed paths |
| AWS Bedrock Claude                     | Bedrock runtime Messages payload          | SSE    | not started |
| Vertex AI Gemini                       | `streamGenerateContent` + OAuth           | SSE    | not started |
| NovelAI text                           | NovelAI text-generation API               | SSE    | not started |
| NovelList                              | NovelList API                             | SSE    | not started |
| Native Ollama                          | `/api/chat`                               | SSE    | not started |
| ooba OAI-compatible                    | `/v1/completions`                         | SSE    | not started |
| Stable Horde (text)                    | `/v2/generate/text/async`                 | poll   | not started |

Providers/features that stay browser-local, LAN-local, or
plugin-local should return a documented `501` from the server route
when they are addressed by a server route:

- Plugin legacy providers - plugin code execution stays in the
  browser sandbox.
- WebLLM and Hugging Face `hf:::` models - in-browser models.
- transformers.js image embedding - browser ML.
- Browser Web Speech, VoiceVox, Vits, GPT-SoVITS, and Fish Speech -
  local / browser TTS.

## Helper providers

| Endpoint                             | Providers                            | Status      |
| ------------------------------------ | ------------------------------------ | ----------- |
| `POST /api/v1/generate/translate`    | DeepL, DeepLX, Google free / HTML, Bergamot, LLM | not started |
| `POST /api/v1/generate/tts`          | OpenAI, ElevenLabs, NovelAI, Hugging Face API Inference | not started |
| `POST /api/v1/generate/image`        | WebUI, NovelAI, Stability, fal,      | not started |
|                                      | ComfyUI / legacy Comfy, Imagen,      |             |
|                                      | OpenAI-compatible image, WaveSpeed,  |             |
|                                      | kei                                  |             |
| `POST /api/v1/generate/count-tokens` | tiktoken, Mistral, NovelAI, Claude, Llama / Llama 3, NovelList, Gemma, Cohere, DeepSeek / DeepSeek V4, GLM4 / GLM5 | not started |

## Reference

- `move-to-fastify/server/fastify/src/generation.ts` and the
  per-provider commits (`648fe0fb`-`5034ff42`) are the worked
  examples for each upstream's quirks.
- `risuai-metatron/server-py/tests/test_generation_provider_*.py`
  is the closest test pattern at scale.
