# Runtime Stages

Date: 2026-05-27

Stages a `sendChat` invocation moves through and who owns each one.
Stage names match the `stage1`-`stage4` timing markers in
`src/ts/process/index.svelte.ts`.

## Stage 0 - UI lease and dispatch

Owner: browser.

- Acquires `doingChat` lease, sets spinner, forwards `AbortSignal`.
- Collects inlay assets and ships them in the request body.
- Receives SSE events and applies them to the rendered chat.
- Releases the lease on `done` / `error` / abort.

## Stage 1 - Validate and message sync

Owner: server.

- Reads chat + character by id, validates mode.
- Checks `expectedRevision`; rejects stale requests with 409.
- Persists the user row before prompt assembly begins.

## Stage 2 - Prompt assembly

Owner: server.

- Walks `promptTemplate`; substitutes variables; resolves persona,
  description, author note, lorebook, memory.
- Computes the final `messages[]` payload.
- Runs prompt/request-state triggers.

## Stage 3 - Provider dispatch and streaming

Owner: server.

- Resolves provider config, issues upstream request.
- Forwards SSE chunks (`token` / `message_patch` / `info` / `warning`).
- Aborts upstream on client disconnect.
- Persists assistant row on completion.

## Stage 4 - Finalize and post-generation

Owner: mostly server.

Server: text trimming, auto-continue, emotion rewriting, reroll
metadata, `editOutput` triggers.

Browser: TTS playback, image preview rendering, browser image
embedding.
