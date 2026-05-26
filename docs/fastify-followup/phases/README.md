# Fastify Follow-Up Phases

Date: 2026-05-27

These files track first-audit follow-up work found after Phases 0-9.
Use the original `docs/fastify/phases/` files for scope and boundary
context; use this directory for first-audit task scope and closeout
criteria. Current alpha work is in `docs/fastify-followup-alpha/phases/`.

## Phase Index

| Phase                           | State    | Doc                                                                          |
| ------------------------------- | -------- | ---------------------------------------------------------------------------- |
| 0 - Removals                    | Closed   | [`phase-0-removals-followup.md`](phase-0-removals-followup.md)               |
| 3 - Proxy migration             | Closed   | [`phase-3-proxy-followup.md`](phase-3-proxy-followup.md)                     |
| 6 - Server-side generation      | Closed   | [`phase-6-generation-followup.md`](phase-6-generation-followup.md)           |
| 7 - Server-side prompt assembly | Closed   | [`phase-7-prompt-assembly-followup.md`](phase-7-prompt-assembly-followup.md) |
| 8 - Hypa V3 memory server-side  | Closed   | [`phase-8-memory-followup.md`](phase-8-memory-followup.md)                   |
| 9 - Client thinning             | Closed   | [`phase-9-client-thinning-followup.md`](phase-9-client-thinning-followup.md) |

## Dependency Order

```text
Phase 7 and Phase 9 follow-up are closed again.
Phase 8 follow-up is closed again after missing-summary follow-ups.
Phase 6 follow-up is closed again after Ollama stream failure alignment.
Phase 0 follow-up is closed again after 0A.
Phase 3 follow-up is closed again after response-header alignment.
No immediate pickup remains from the first audit.
```

## Session Slice Index

Each slice is intended to fit in one focused work session with its own
implementation, tests, and handoff update.

| Slice | Phase | Scope                                                                                                 |
| ----- | ----- | ----------------------------------------------------------------------------------------------------- |
| 9A    | 9     | Provider routing and model scalar settings.                                                           |
| 9B    | 9     | OpenRouter, auxiliary model, and separate-parameter selectors.                                        |
| 9C    | 9     | Image provider settings.                                                                              |
| 9D    | 9     | Memory and audio provider settings.                                                                   |
| 9E    | 9     | Persona, display/theme, global regex, lore preset, and bot preset editors.                            |
| 9F    | 9     | Plugin, custom model, and advanced setting editors.                                                   |
| 9G    | 9     | Character core profile, media, and basic option editors.                                              |
| 9H    | 9     | Character lore, script, prompt, TTS, and chat-name editors.                                           |
| 9I    | 9     | Sidebar toggles, custom sidebar/loadout helpers, welcome setup, and runtime API write classification. |
| 9J    | 9     | Final direct-write sweep and closeout.                                                                |
| 7A    | 7     | Browser regenerate request wiring.                                                                    |
| 7B    | 7     | Server regenerate assembly semantics.                                                                 |
| 7C    | 7     | `/chat` provider dispatch guards.                                                                     |
| 7D    | 7     | Stop-trigger mutation payload delivery.                                                               |
| 7E    | 7     | Route-backed fixture coverage.                                                                        |
| 8A    | 8     | Custom embedding follow-up routing.                                                                   |
| 8B    | 8     | Production memory progress events.                                                                    |
| 8C    | 8     | Missing-summary diagnostics.                                                                          |
| 6A    | 6     | Stream error contract and OpenAI-compatible path.                                                     |
| 6B    | 6     | Anthropic, Mistral, and Gemini stream failures.                                                       |
| 6C    | 6     | Ollama and final stream audit.                                                                        |
| 0A    | 0     | Google Drive public artifact removal.                                                                 |
| 3A    | 3     | Proxy response-header alignment.                                                                      |

## No Follow-Up Found

The audit did not identify remaining tasks for Phases 1, 2, 4, or 5.
Do not reopen those phases unless a new code finding appears.
