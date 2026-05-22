# Next Steps

Date: 2026-05-22

Use this list to pick the next chunk of work. Phase 5 closed on
2026-05-22 with all 28 extraction slices landed; the historical
slice record now lives in
[`sendchat-slicing.md`](sendchat-slicing.md). Phase 6 is active,
and commit history through Phase 6-18 shows provider coverage
landed through reverse_proxy OAI-compat (full DSL + ooba
system hoist + risu:: header).

## Immediate

1. **Continue Phase 6 provider coverage.** The completion route,
   normalized SSE envelope, client adapter, and dual-mode fixture
   harness are in place. Current server-backed coverage includes
   echo, vanilla OpenAI, NanoGPT chat, OpenRouter, vanilla
   Anthropic (+ Anthropic Legacy and NanoGPT Messages), vanilla
   Mistral, vanilla Cohere (buffered only), the DeepSeek /
   DeepInfra OpenAI-compatible keyIdentifier path, vanilla Google
   AI Gemini, OpenAI Legacy Instruct (+ NanoGPT Legacy), OpenAI
   Responses API (+ NanoGPT Responses), Ollama Cloud variants,
   Kobold, ooba legacy, native Ollama `/api/chat` (buffered +
   NDJSON streaming), `xcustom:::id` OAI-compat with the
   `additionalParams` body/header overlay DSL, and the
   `reverse_proxy` path under OpenAI-compatible (URL autofill,
   `risu::` → `X-Proxy-Risu` header lift, `db.reverseProxyOobaMode`
   system hoisting). Still remaining: NovelAI, NovelList, ooba
   OAI-compatible `/v1/completions` (open design question — local
   path uses Jinja chat templates, not the `## User` flatten),
   Vertex AI Gemini, AWS Bedrock Claude, Stable Horde, and
   reverse_proxy variants whose `db.customAPIFormat` points at
   Anthropic / Mistral / etc. (need their own slices). Keep the
   33 local sendChat snapshots, the 7-fixture server-backed
   sweep, and the Fastify generation tests green
   (`pnpm api:test`: 352, `pnpm test`: 548 + 4 skipped).

2. **Follow-up: hub-route session auth.** `ANY /api/v1/hub/*` is
   still gated by `requireAuth`, so password-protected deployments
   can 401 browser-loaded hub resources that cannot send
   `risu-auth` headers. The accepted Phase 3D-Broad decision was
   to ship this limitation and revisit either public hub proxying
   or session-cookie auth when needed.

## Landed Phase 6 Slices

| Slice | Commit     | Summary                                                                                                                   |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| 6-1   | `dd512203` | Added auth-gated `POST /api/v1/generate/completion`, the normalized `chunk` / `done` SSE envelope, and the echo provider. |
| 6-2   | `d3d3f608` | Added the flag-gated client adapter for echo through `/api/v1/generate/completion`.                                       |
| 6-3   | `8f4209b3` | Added the dual-mode fixture harness and `echo-basic`.                                                                     |
| 6-4a  | `add21521` | Added the OpenAI Chat Completions dispatcher and route coverage.                                                          |
| 6-4b  | `8bd5158a` | Routed vanilla OpenAI from the client adapter and added `openai-basic`.                                                   |
| 6-4c  | `3b81f65c` | Added NanoGPT chat and OpenRouter variants on the OpenAI-compatible dispatcher.                                           |
| 6-5   | `0bbdbaa9` | Added Anthropic Messages end to end and `anthropic-basic`.                                                                |
| 6-6   | `926bba1c` | Added Mistral request shaping, streaming / buffered dispatch, tests, and `mistral-basic`.                                 |
| 6-7   | `f957dba8` | Added Cohere buffered dispatch, tests, and `cohere-basic`.                                                                |
| 6-8   | `6c9b39e8` | Routed DeepSeek / DeepInfra keyIdentifier models through the OpenAI-compatible dispatcher and added `deepseek-basic`.     |
| 6-9   | `cab433f3` | Added vanilla Google AI Gemini request shaping, streaming / buffered dispatch, tests, and `gemini-basic`.                 |
| 6-10  | `ca8fb5f9` | Added OpenAI legacy instruct and NanoGPT legacy over `/v1/completions` (buffered only).                                   |
| 6-11  | `e8bbbf61` | Routed Anthropic Legacy and NanoGPT Messages through the Anthropic-compatible dispatcher.                                 |
| 6-12  | `b1343d9e` | Added OpenAI Responses API and NanoGPT Responses (buffered only).                                                         |
| 6-13  | `76ec283c` | Routed Ollama Cloud through OpenAI / Responses / Anthropic dispatchers based on `db.ollamaRequestFormat`.                 |
| 6-14  | `f6b88f01` | Added Kobold and ooba legacy buffered dispatchers and tests.                                                              |
| 6-16  | `c919e683` | Added native Ollama `/api/chat` dispatcher with NDJSON streaming, adapter `db.ollamaURL` gate, and route + dispatcher tests. |
| 6-17  | `da7d05b8` | Routed `xcustom:::<id>` OAI-compat through the openai dispatcher with the `additionalParams` body/header overlay DSL ported server-side. |
| 6-18  | `425d8302` | Routed `reverse_proxy` OAI-compat through the openai dispatcher with URL autofill, `risu::` → `X-Proxy-Risu` header lift, server-side `oobaSystemHoist`, and `db.additionalParams` overlay. |

The detailed per-slice notes that used to live in this file were
folded into the current status shards:

- [`sendchat-slicing.md`](sendchat-slicing.md) for Phase 4/5
  fixture gates and extraction history.
- [`server.md`](server.md) for current Fastify routes and provider
  dispatchers.
- [`../coverage/providers.md`](../coverage/providers.md) for the
  provider test matrix.
- [`../coverage/sendchat-fixtures.md`](../coverage/sendchat-fixtures.md)
  for local and server-backed fixture inventory.

## Closed

Do not reopen these choices without adding a short rationale here
and updating the relevant phase doc:

- Tauri stays as-is. Do not add or modify Tauri-specific code in
  Phase 0-9.
- Hub proxy stays. The legacy `/hub-proxy/*` route was removed with
  Express; Fastify keeps `/api/v1/hub/*`.
- No whole-state PUT in the Fastify API.
- Only Hypa V3 survives. Do not re-introduce Supa, Hypa V2, or
  Hanurai.
- Fastify authenticated routes are ES256-only. Do not add a
  password-header acceptance path to `requireAuth` or individual
  routes. The WebSocket upgrade is the documented exception that
  accepts `risu-auth` through a query string.

## Verification before closing a slice

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Tauri build is verified manually at phase boundaries, not
per-slice.
