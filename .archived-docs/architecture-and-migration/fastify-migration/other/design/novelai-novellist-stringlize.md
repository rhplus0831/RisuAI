# NovelAI + NovelList Stringlize Deferral

Date: 2026-05-25

Status: no-port. NovelAI and NovelList routing is not part of the
completed Fastify route surface unless a new provider-flattening phase
reopens it.

Sibling decision: [`ooba-oai-compat.md`](ooba-oai-compat.md)

## Decision

Do not port the SPA's NovelAI / NovelList `stringlize` and
`unstringlize` helpers as standalone Phase 6-style dispatchers.

NovelAI and NovelList use flat prompt-string wires plus bespoke sampler
blocks, then trim the provider continuation back into an assistant turn.
The legacy browser helpers depend on character name, user name, per-message
metadata, and memo tags. Those dependencies are exactly the server prompt
context that later migration phases are meant to centralize.

## Rationale

There are two viable future shapes:

- **Server-owned flattening:** port stringlize / unstringlize once the
  server owns character, user, and message context. This keeps the normal
  server contract messages-in, result-out.
- **Prompt-string fast path:** let the client or a server prompt layer send
  a pre-flattened prompt string for provider families whose native API is
  already flattened. This is more acceptable for NovelAI / NovelList than
  for Ooba, because their upstream wires are not OpenAI-message-shaped.

The completed roadmap keeps these no-port so Fastify does not inherit
provider-specific context plumbing without a dedicated route design.

## Reopen Triggers

- A fixture requires NovelAI / NovelList parity through the Fastify route.
- The project accepts a general prompt-string fast path for flattened
  provider families.
- Output trimming or tokenizer behavior diverges enough that server-side
  control becomes necessary.

## References

- Provider matrix: [`../coverage-records/providers.md`](../coverage-records/providers.md)
- Legacy NovelAI / NovelList behavior is historical reference material
  until this decision is reopened.
