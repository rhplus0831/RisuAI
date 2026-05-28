# Ooba OAI-compat Deferred Routing

Date: 2026-05-25

Status: no-port. `LLMFormat.Ooba` OAI-compatible routing is not part of
the completed Fastify route surface unless a new provider-flattening
phase reopens it.

## Decision

Do not route Ooba OAI-compatible generation through the existing
`openai-legacy-instruct` dispatcher yet.

The wire format looks compatible with OpenAI legacy completions, but the
prompt format is not. The legacy browser path called
`applyChatTemplate(formated)` with the user's selected
`db.instructChatTemplate` / `db.JinjaTemplate`; the current server legacy
instruct flattener emits a different `## User` / `## Response` style
prompt. Reusing that dispatcher would silently change output quality and
could make models emit unexpected markers.

## Rationale

Ooba needs the same character/user/message context that Phase 7 and later
server prompt assembly are meant to own. Adding one-off client-side
pre-flattening or ad-hoc `risuChar` / `risuUser` option plumbing would
create a temporary contract that Phase 9 would have to unwind.

A future Fastify route should happen only when one of these is true:

- The server ports `applyChatTemplate`, built-in templates, custom Jinja
  templates, template effects, and character/user substitution as a
  general prompt-flattening capability.
- A later phase intentionally accepts a prompt-string fast path for
  provider families whose native wire is already flattened.

## Reopen Triggers

- Ooba support becomes load-bearing for a fixture or deployment.
- NovelAI / NovelList take a prompt-string fast path and the project wants
  a consistent rule for flattened-provider contracts.

## References

- Provider matrix: [`../coverage/providers.md`](../coverage/providers.md)
- Sibling decision: [`novelai-novellist-stringlize.md`](./novelai-novellist-stringlize.md)
