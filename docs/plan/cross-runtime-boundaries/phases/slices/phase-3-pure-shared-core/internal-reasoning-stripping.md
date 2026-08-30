# Internal-Reasoning Stripping

Status: ready.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core legacy OpenAI model-alias leaf at `23e5a4b30`.

## Objective

Move the browser/Node-neutral internal-reasoning tag stripper into the audited
shared-core owner without changing generation, translation, or agent output.

## Source And Destination

- Source: `src/ts/process/internalReasoning.ts`.
- Destination: an explicit `@risuai/shared-core` subpath.
- Consumers: browser translator/pipeline plus Fastify generation CoT stripping,
  raw-message translation, and agent-preset output processing.

## Behavior Contract

- Preserve case-insensitive `Thoughts` and `think` tag matching, optional
  spacing/attributes, and nested hidden-depth behavior.
- Preserve unmatched closing tags, unterminated opening tags, visible segment
  joining, and final `trim()` behavior exactly.
- Preserve `{ preserveUnchanged: true }` returning the original unchanged string
  when no opening tag exists.
- Do not change generation frames, translation pipelines, agent output bounds,
  prompts, persistence, streaming, or UI behavior.

## Validation

Shared-core import audit and typecheck, focused differential tag fixtures,
browser translator/pipeline and Fastify generation/translation/agent owning
tests, both typechecks, architecture inventory, formatting, and
`git diff --check`.

## Done When

- All five production consumers use the shared subpath.
- The browser-tree implementation is deleted and the three matching Fastify
  cross-runtime edges disappear without a new exception.
- Nested, malformed, unchanged, and trimmed outputs match the pre-extraction
  behavior in browser and Fastify tests.

Stop if the helper needs model state, prompt assembly, persistence, streaming,
browser reactivity, or another runtime-specific dependency.
