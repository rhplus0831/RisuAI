# Provider-Message Input Seam

Status: complete at `e0be7d72e`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: BardWiki server type seam at `44e53527a`.

## Objective

Remove provider-wire conversion's direct type-only browser prompt-model import
by owning the exact input row and multimodal records in Fastify.

## Delivered Boundary

- `providerMessages.ts` owns message roles, content, names, memo markers,
  multimodal payloads, thoughts, cache points, and ignored internal metadata.
- OpenAI, Anthropic, and text-only wire projections are unchanged.
- One production type-only browser-application-model edge was removed.

## Preserved Contract

NewChat filtering, developer-role conversion, function/example names, image
order and quality, Anthropic data-URL parsing/coalescing/cache points, DeepSeek
prefix/thought handling, and metadata stripping remain unchanged. Dispatch,
credentials, prompt assembly, persistence, and events remain in their existing
owners.

## Proof

Provider conversion passed six focused tests, the ownership assertion passed one
test, both typechecks passed, and the architecture baseline closed at 279 edges.
