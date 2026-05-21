# Phase 7 - Server-Side Prompt Assembly

Date: 2026-05-21

## Goal

Move Stage 2 (prompt assembly, lorebook activation, persona /
description / author note injection, tokenizer-driven budget
pruning) behind a single Fastify route. The browser stops walking
the preset template; it sends intent and gets back the assembled
OpenAI-shaped payload (or a streamed completion that uses it).

## Preconditions

- Phase 2 closed (server holds presets, lorebooks, personas,
  characters).
- Phase 6 closed (server can dispatch the assembled payload).

## Scope

### Routes

- `POST /api/v1/generate/chat` - high-level intent endpoint.
  Inputs:

  ```jsonc
  {
    "chatId": "...",
    "characterId": "...",
    "presetId": "...",         // optional; defaults to active
    "loadoutId": "...",        // optional
    "mode": "send" | "continue" | "preview" | "preview_prompt"
            | "regenerate",
    "regenerateMessageId": "...",  // when mode === "regenerate"
    "userMessage": "...",          // when mode === "send"
    "resetMessages": true,         // when starting a fresh chat
    "expectedRevision": 1234,
    "inlayAssets": [...],          // browser-uploaded blobs
    "clientCapabilities": {
      "sseEvents": ["stage", "prompt", "info", "token",
                    "message_patch", "side_effect",
                    "warning", "error", "done"]
    }
  }
  ```

  Output: SSE stream with the event types listed above.

- `POST /api/v1/generate/preview-prompt` - shorthand for the
  `preview_prompt` mode. Returns the assembled `messages[]`
  without dispatching to a provider. Useful for DevTools.

### Assembly modules

Under `server/fastify/src/prompt/`:

- `assemble.ts` - walks the preset's `promptTemplate`. Substitutes
  `{{user}}`, `{{char}}`, persona, description, author note,
  example messages, scenario, jailbreak.
- `lorebook.ts` - constant + keyword + recursion. Budget-aware.
  Returns activation metadata (which entries fired, why) for
  `prompt` SSE events.
- `history.ts` - chat history shaping (role mapping, multimodal
  fold-in, ChatML-style assembly).
- `templates.ts` - prompt template cards (chat ranges, cache
  markers, systemized chat, position slots).
- `tokens.ts` - budget pruning. Reuses the tokenizer from Phase 6.
- `variables.ts` - `risuChatParser` port for variable expansion,
  `#when`, conditional cards.
- `triggers.ts` - hooks `editInput` / `editRequest` into the
  trigger sandbox from Phase 6.

### SSE events

The `chat` route streams:

- `stage` - `{ stage: "validate" | "prompt" | "provider" | "done",
status: "start" | "end" }`.
- `prompt` - the assembled `messages[]`, prompt info, lorebook
  activation report.
- `info` - telemetry (timings, token counts).
- `token` - raw provider tokens (non-authoritative; for UX).
- `message_patch` - the authoritative chat row changes.
- `side_effect` - `{ kind: "tts" | "image" | "inlay_screen" |
"hypav3_progress" | "stable_diff", ... }`.
- `warning` - non-fatal issues.
- `error` - terminal error; includes restoration patches.
- `done` - canonical final message + generation info.

### Browser changes

The browser-side prompt extraction modules from Phase 5 shrink to
thin adapters in server-backed mode. The coordinator posts to
`/api/v1/generate/chat` and iterates the stream. The bridge owns:

- UI lease, abort forwarding.
- Inlay asset collection (still browser-only).
- Side-effect dispatch (TTS playback, image preview).
- Local restoration on `error` / abort.

## Boundaries

- **Do not redesign the preset format.** Server reads what the
  browser already writes. Schema migration is out of scope.
- **Do not move memory yet.** This route reads Hypa V3 summaries
  through whatever adapter exists (browser or server) and ships
  them; Phase 8 wires the server-side adapter.
- **Do not implement plugin code execution.** Plugins that expose
  custom prompt items return their text via the existing browser
  bridge for now. Server-side plugin execution is out of the
  migration scope.
- **Do not change the SSE event shape across phases.** Once Phase
  7 ships an event, Phase 9 must not rename it.

## Exit criteria

- The Phase 4 / 5 fixture set runs against the server route and
  produces identical observable output (with the upstream provider
  faked at the server boundary).
- `pnpm api:test` includes prompt snapshot tests: given a canned
  database + preset + chat state, `assembled === expected`.
- `pnpm test`, `pnpm check`, `pnpm build`, `pnpm api:test` green.

## Reference

- `move-to-fastify` lands a Phase-7 ancestor as
  `/api/v1/generate/completion-with-assembly`. We are skipping
  that indirection; `chat` is the assembled endpoint.
- `risuai-metatron`'s `chat_generation/prompt_builder.py`,
  `prompt_sections.py`, `prompt_history.py`, `prompt_templates.py`,
  `prompt_budget.py`, `context.py`, `lorebook.py` are the closest
  template at full scale. Plan on the assembly modules being
  smaller than that (the Python port absorbed years of drift).
