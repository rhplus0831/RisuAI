# HANDOVER

Date: 2026-05-22
Branch: `fastify`
Base head before this docs audit: `a8cb123b docs: backfill Phase 6-28 commit hash in next-steps.md`

## Current State

Phases 0-6 are closed. Phase 6's `/api/v1/generate/completion`
work closed in `398a3ae6` (Phase 6-28), with the closeout hash
backfilled by `a8cb123b`. The phase doc's
[`Closeout`](docs/fastify/phases/phase-6-server-generation.md#closeout-2026-05-22)
section is the canonical inventory.

Fastify currently owns bootstrap, JSON import, assets, backups,
static SPA serving, provider proxy fetch, stream-job WebSocket,
hub passthrough, legacy NodeStorage / crypto compatibility, and
the closed completion provider matrix. Express is deleted; Docker
runs `pnpm api:start` on port 6002 with `/app/data` persisted.

Guardrails at Phase 6 closeout:

- `pnpm api:test`: 434 across 27 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: clean
- `sendChat` fixtures: 38 local snapshots, 12 of them also run
  through the server-backed sweep

Recent history to keep in mind:

- `755bbe83` through `7ae69fd8` ported `additionalParams`,
  `reverse_proxy`, and `xcustom:::` overlays to Mistral, Cohere,
  OpenAI Responses, and OpenAI legacy instruct.
- `cb6d876c` (Phase 6-27) added the five newest dual-mode fixtures:
  `gemini-vertex-basic`, `bedrock-basic`, `horde-basic`,
  `mistral-reverse-proxy-basic`, and
  `anthropic-reverse-proxy-basic`.
- `398a3ae6` (Phase 6-28) closed the completion slice and moved
  `status/next-steps.md` to Phase 7.

## Next Work

Start **Phase 7: server-side prompt assembly**. Read these first:

- [`docs/fastify/status/next-steps.md`](docs/fastify/status/next-steps.md)
- [`docs/fastify/phases/phase-7-prompt-assembly.md`](docs/fastify/phases/phase-7-prompt-assembly.md)
- [`docs/fastify/phases/phase-6-server-generation.md`](docs/fastify/phases/phase-6-server-generation.md)
- [`docs/fastify/coverage/providers.md`](docs/fastify/coverage/providers.md)
- [`docs/fastify/coverage/sendchat-fixtures.md`](docs/fastify/coverage/sendchat-fixtures.md)

Open decision before Phase 7 implementation: Ooba OAI-compatible,
NovelAI text, and NovelList need prompt flattening with character /
user state. The Horde slice proved an interim option-B pattern
(client pre-flattens with `applyChatTemplate`, server receives a
`prompt`, client unstringlizes the result). Phase 7 can either use
that pattern for the three deferred providers or wait for
server-owned flattening. Design memos:

- [`docs/fastify/design/ooba-oai-compat.md`](docs/fastify/design/ooba-oai-compat.md)
- [`docs/fastify/design/novelai-novellist-stringlize.md`](docs/fastify/design/novelai-novellist-stringlize.md)

## Useful Patterns

- OpenAI-compatible chat: `server/fastify/src/generation/openai.ts`
  and `mistral.ts`.
- Anthropic Messages: `anthropic.ts`.
- Buffered-only dispatch: `cohere.ts`,
  `openaiLegacyInstruct.ts`, `openaiResponses.ts`, `bedrock.ts`,
  and `horde.ts`.
- Flat-prompt helper: `openaiLegacyInstruct.ts`.
- Vertex JWT auth: `vertexAuth.ts`.
- Bedrock SigV4: `sigv4.ts`.
- Async polling + abort cleanup: `horde.ts`.
- Variant gates / client adapter: `src/ts/process/request/serverCompletion.ts`.
- Completion route tests: `server/fastify/__tests__/`.
- Dual-mode fixtures: `src/ts/process/__fixtures__/` plus
  `sendChat.fixtures.serverBacked.test.ts`.

## Follow-Ups Not Blocking Phase 7

- Hub resources still use `requireAuth`; browser-loaded hub assets
  can 401 on password-protected deployments until session-cookie or
  public hub proxy support lands.
- Helper generation routes remain separate slices:
  `/generate/translate`, `/tts`, `/image`, `/count-tokens`,
  `/encodings`, and `/triggers/run`.
- Bedrock streaming, OpenAI MultiGen, ooba-legacy WebSocket
  streaming, and other buffered-only streaming upgrades are
  deferred until fixtures demand them.
- Server-side key masking (`RISU_MASK_SERVER_KEYS=1`) waits until
  the server owns every provider path a deployment needs.

## Commit Convention

Use `feat:`, `fix:`, `refactor:`, or `docs:` prefixes. Each slice
gets its own commit. After a slice lands, update
`docs/fastify/status/next-steps.md` with the new slice row, current
test counts, and remaining uncovered work.

Trailer used by prior slices:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
