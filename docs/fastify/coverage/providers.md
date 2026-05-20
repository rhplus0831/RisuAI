# Provider Tests

Date: 2026-05-20

Status: no server-side provider implementations exist yet. The
table below is the target test matrix for Phase 6.

## Required per provider

For each provider that lands in `/api/v1/generate/completion`:

- Happy path: request shaping matches upstream contract.
- Streaming: chunks normalized into the SSE envelope.
- Error: upstream 4xx / 5xx maps to a documented error frame.
- Abort: client disconnect aborts upstream within ~1s.
- Headers: API key sourced from `auth` settings group; not
  echoed in upstream body.

## Provider inventory

| Provider               | Request shape                | Stream | Status      |
| ---------------------- | ---------------------------- | ------ | ----------- |
| OpenAI                 | Chat Completions             | SSE    | not started |
| openai-compatible      | Chat Completions             | SSE    | not started |
| OpenRouter             | Chat Completions             | SSE    | not started |
| NanoGPT                | Chat Completions             | SSE    | not started |
| Mistral                | Chat Completions             | SSE    | not started |
| Cohere                 | Cohere chat                  | SSE    | not started |
| Huggingface            | Chat Completions             | SSE    | not started |
| DeepInfra              | Chat Completions             | SSE    | not started |
| Anthropic              | Messages                     | SSE    | not started |
| Gemini / Google        | generateContent / streamGen  | SSE    | not started |
| Vertex AI (Gemini)     | streamGenerateContent + OAuth| SSE    | not started |
| Ollama                 | /api/chat                    | SSE    | not started |
| Kobold                 | /api/v1/generate             | poll   | not started |
| ooba (text-generation-webui) | /v1/chat/completions   | SSE    | not started |
| llama.cpp server       | /v1/chat/completions         | SSE    | not started |
| Stable Horde (text)    | /v2/generate/text/async      | poll   | not started |

Providers that stay browser-local (target LAN endpoints) - they
return a documented `501` from the server route:

- VoiceVox, Vits, GPT-SoVITS - TTS.
- WebLLM - in-browser model.
- transformers.js image embedding - browser ML.

## Helper providers

| Endpoint                             | Providers                            | Status      |
| ------------------------------------ | ------------------------------------ | ----------- |
| `POST /api/v1/generate/translate`    | DeepL, DeepLX, Google free, LLM      | not started |
| `POST /api/v1/generate/tts`          | OpenAI, ElevenLabs, NovelAI          | not started |
| `POST /api/v1/generate/image`        | DALL-E, Stability, Imagen, fal,      | not started |
|                                      | NovelAI, wavespeed, WebUI, kei,      |             |
|                                      | ComfyUI                              |             |
| `POST /api/v1/generate/count-tokens` | cl100k, o200k, p50k, r50k, gpt2      | not started |

## Reference

- `move-to-fastify/server/fastify/src/generation.ts` and the
  per-provider commits (`648fe0fb`-`5034ff42`) are the worked
  examples for each upstream's quirks.
- `risuai-metatron/server-py/tests/test_generation_provider_*.py`
  is the closest test pattern at scale.
