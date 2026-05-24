# NovelAI + NovelList Stringlize Deferral

Date: 2026-05-25

Status: deferred. Keep NovelAI and NovelList local until server-owned
prompt flattening includes provider-specific stringlize / unstringlize.

Sibling decision: [`ooba-oai-compat.md`](./ooba-oai-compat.md)

## Decision

Do not port the SPA's NovelAI / NovelList `stringlize` and
`unstringlize` helpers as standalone Phase 6-style dispatchers.

NovelAI and NovelList use flat prompt-string wires plus bespoke sampler
blocks, then trim the provider continuation back into an assistant turn.
The local helpers depend on character name, user name, per-message
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

The migration currently chooses deferral so Phase 6 does not invent
provider-specific context plumbing that Phase 7/9 would later replace.

## Revisit Triggers

- Server-backed client thinning needs NovelAI or NovelList to avoid local
  browser dispatch.
- A fixture requires NovelAI / NovelList parity through the Fastify route.
- The project accepts a general prompt-string fast path for flattened
  provider families.
- Output trimming or tokenizer behavior diverges enough that server-side
  control becomes necessary.

## References

- Provider matrix: [`../coverage/providers.md`](../coverage/providers.md)
- Local NovelAI / NovelList behavior is still the source of truth until
  this decision is reopened.
