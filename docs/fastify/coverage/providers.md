# Provider Tests

Date: 2026-05-22

Status: Phase 6 has started. The server-backed completion route
currently implements echo, OpenAI Chat Completions, NanoGPT,
OpenRouter, and Anthropic Messages. The table below tracks the
remaining provider matrix.

## Required per provider

For each provider that lands in `/api/v1/generate/completion`:

- Happy path: request shaping matches upstream contract.
- Streaming: chunks normalized into the SSE envelope.
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
| Echo developer provider                | local deterministic echo                  | SSE envelope | covered by `server/fastify/__tests__/echo.test.ts` and `generation.completion.test.ts`; dual-mode fixture `echo-basic` |
| OpenAI Chat Completions                | `/v1/chat/completions`                    | SSE    | covered by `server/fastify/__tests__/openai.test.ts` and `generation.completion.test.ts`; dual-mode fixture `openai-basic` |
| OpenRouter                             | Chat Completions-compatible via `https://openrouter.ai/api/v1` with `X-Title` + `HTTP-Referer` | SSE | covered by `generation.completion.test.ts` and `serverCompletion.test.ts` |
| NanoGPT chat                           | Chat Completions-compatible via `https://nano-gpt.com/api/v1` or subscription endpoint, optional `X-Provider` | SSE | covered by `generation.completion.test.ts` and `serverCompletion.test.ts` |
| Anthropic Messages                     | `/v1/messages`                            | SSE    | covered by `server/fastify/__tests__/anthropic.test.ts` and `generation.completion.test.ts`; dual-mode fixture `anthropic-basic` |
| OpenAI Responses API                   | `/v1/responses`                           | SSE    | not started |
| OpenAI legacy instruct                 | legacy completions / instruct shape       | SSE    | not started |
| OpenAI-compatible custom / reverse proxy / xcustom / DeepSeek / DeepInfra | Chat Completions-compatible with user endpoint or key identifier | SSE | still local; client gate refuses these server-backed paths |
| NanoGPT responses / messages / legacy  | NanoGPT endpoint selected by format       | SSE    | not started |
| Mistral                                | Mistral chat                              | SSE    | not started |
| Cohere                                 | Cohere chat                               | SSE    | not started |
| Anthropic legacy                       | legacy Claude shape                       | SSE    | not started |
| AWS Bedrock Claude                     | Bedrock runtime Messages payload          | SSE    | not started |
| Gemini / Google                        | `generateContent` / streaming generate    | SSE    | not started |
| Vertex AI Gemini                       | `streamGenerateContent` + OAuth           | SSE    | not started |
| NovelAI text                           | NovelAI text-generation API               | SSE    | not started |
| NovelList                              | NovelList API                             | SSE    | not started |
| Ollama hosted / Ollama Cloud           | `/api/chat`, or cloud OpenAI / Responses / Anthropic format | SSE | not started |
| Kobold                                 | `/api/v1/generate`                        | poll   | not started |
| ooba / text-generation-webui legacy    | WebSocket + blocking endpoints            | WS/poll | not started |
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
