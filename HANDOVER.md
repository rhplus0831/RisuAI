# HANDOVER

Date: 2026-05-22
Branch: `fastify`
Head: `067414ff docs: backfill Phase 6-27 commit hash in next-steps.md`

This file is the working handover from the previous agent. Read
`docs/fastify/phases/phase-6-server-generation.md` for the closed
Phase 6 scope (see "Closeout" section at the bottom of that doc)
and `docs/fastify/phases/phase-7-prompt-assembly.md` for the
phase that follows. `docs/fastify/status/next-steps.md` carries
the per-slice history.

## Phase 6 is closed

As of `cb6d876c` + `067414ff` (Phase 6-27 fixture sweep), the
`/completion` part of Phase 6 is done. The phase doc has a full
closeout section listing what landed, what was deferred to Phase 7,
and what was deferred until a fixture demands it.

Test counts at closeout:

- `pnpm api:test`: 434 across 27 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: clean

## What's next

The next thing to start is **Phase 7 (prompt assembly)**. Phase 6
deliberately did not move prompt assembly server-side; that's
Phase 7's whole job. Three providers (Ooba OAI-compat, NovelAI
text, NovelList) were explicitly deferred to Phase 7 because
their prompt flatten needs server-owned character + user state.
The memos describe the trade-offs:

- [`docs/fastify/design/ooba-oai-compat.md`](docs/fastify/design/ooba-oai-compat.md)
- [`docs/fastify/design/novelai-novellist-stringlize.md`](docs/fastify/design/novelai-novellist-stringlize.md)

The Horde slice (Phase 6-22) shipped a **client-side option-B**
pattern as an interim — client pre-flattens via `applyChatTemplate`,
server takes a `prompt` string, client unstringlizes the result.
If Phase 7 decides to ship Ooba / NovelAI / NovelList with the
same pattern instead of moving the flatten server-side, each is
~150 LOC and unblocks immediately. The current memos lean toward
server-side flatten, but the option-B pivot is on the table.

The Phase 7 doc (`docs/fastify/phases/phase-7-prompt-assembly.md`)
should be your starting point for understanding the prompt-assembly
move. Open question for the user before starting Phase 7: ship
Ooba / NovelAI / NovelList with option B now or hold them until
the server flatten is built?

## Other Phase 6 follow-ups (not blocking Phase 7)

These can land at any time without re-opening Phase 6:

- **Other `/generate/*` routes**: `/translate`, `/tts`, `/image`,
  `/count-tokens`, `/encodings`, `/triggers/run`. Each is its own
  slice; they don't gate completion or Phase 7.
- **Bedrock streaming**: AWS EventStream parser (~150 LOC) +
  plumbing (~100 LOC). Currently buffered-only; the closeout
  decided to wait for a concrete fixture to demand it.
- **OpenAI MultiGen** (`body.n = db.genTime`): incompatible with
  the current one-stream-per-completion SSE envelope; would need
  a multi-result return shape.

## Patterns to follow

When extending the completion route or adding a new provider,
copy the structure from a similar recent slice:

- **OpenAI-compat wire shape**: copy `mistral.ts` (Phase 6-6).
- **New wire shape with streaming**: copy `gemini.ts` (Phase 6-9).
- **Non-streaming buffered-only**: copy `cohere.ts` (Phase 6-7).
- **Flat-prompt with flatten helper**: copy `openaiLegacyInstruct.ts`
  (Phase 6-10).
- **Variant routing of an existing dispatcher (no new code)**:
  Phase 6-11 anthropic-legacy / NanoGPT-messages is the smallest
  example.
- **additionalParams overlay through an existing dispatcher**:
  copy the openai (Phase 6-17), anthropic (Phase 6-19), mistral
  (Phase 6-23), cohere (Phase 6-24), openai-responses (Phase 6-25),
  or openai-legacy-instruct (Phase 6-26) work.
- **reverse_proxy with URL autofill**: copy Phase 6-18 (OAI-compat),
  6-19 (Anthropic), 6-23 (Mistral, reuses OAI helper), 6-24
  (Cohere, dedicated helper), 6-25 (Responses, dedicated helper),
  or 6-26 (Legacy Instruct, dedicated helper).
- **JWT auth + token cache**: copy `vertexAuth.ts` (Phase 6-20).
- **SigV4 / new pure-JS crypto**: copy `sigv4.ts` (Phase 6-21).
- **Async polling loop with abort cleanup**: copy `horde.ts`
  (Phase 6-22).
- **Dual-mode fixture for a routed provider**: copy any of the
  five fixtures added in Phase 6-27. Each is a JSON db, a
  one-line `upstream/<name>.jsonl` carrying `{type, result, model}`,
  and an auto-recorded expected snapshot.

The dispatcher tests live in `server/fastify/__tests__/` (one
file per dispatcher). The route-level test cases append to
`server/fastify/__tests__/generation.completion.test.ts`. The
adapter test cases (format-map + buildProviderOptions + gate
refusals) go in `src/ts/process/request/tests/serverCompletion.test.ts`.

If a slice adds a dual-mode fixture, follow Phase 6-9's pattern
(`gemini-basic`): the fixture JSON can include an `injectedModels`
field that `loadFixture.ts` pushes into `LLMModels` for the test
only. New fixtures need a per-provider result setter wired in
`sendChat.fixtures.serverBacked.test.ts` so both sweeps see the
same reply text.

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

The Phase 6 numbering went from 6-1 through 6-27. Slices 6-14
through 6-22 were a mix of provider variants, Native Ollama, and
the deferred Vertex / Bedrock / Horde slices. Slices 6-23 through
6-26 ported `additionalParams` to the remaining non-OAI
dispatchers (Mistral, Cohere, OpenAI Responses, OpenAI Legacy
Instruct). Slice 6-27 extended the dual-mode fixture sweep with
five fixtures for the providers that were never covered by the
original 7-fixture set. `docs/fastify/status/next-steps.md` is
authoritative for current numbering and commit hashes.

Phase 7 starts fresh — its slices will be `Phase 7-1`, `Phase 7-2`,
etc., tracked in `docs/fastify/status/next-steps.md` alongside
the Phase 6 history.
