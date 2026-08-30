# Phase 3: Pure Shared Core

Status: active.

Depends on: Phase 0 classification; Phase 1 for any serialized types used by a
candidate.

## Objective

Extract only browser/Node-neutral algorithms, normalizers, and types that have
real consumers in both runtimes, starting with low-fanout leaves.

## Required Work

- Choose leaf helpers before prompt, parser, provider, translator, or generation
  orchestrators.
- Remove Svelte/store, DOM, Fastify, filesystem, process-global, credential,
  database, and host dependencies before moving a module.
- Provide narrow value inputs instead of an aggregate `Database` type.
- Add a shared-core import audit comparable to the protocol package audit.
- Prove browser/server parity with focused fixtures.

## Ownership Rule

Serialized schemas remain in `packages/protocol`. Pure behavior belongs in a
separate audited owner. Server-only policy/persistence stays in Fastify;
browser-only state/reactivity stays under `src/`.

## Exit Criteria

- Every moved module has no framework-specific or host-specific dependency.
- No shared API accepts the aggregate browser database merely for convenience.
- Both runtime consumers pass parity tests and old duplicate implementations are
  removed only after proof.

## Validation

Shared import audit, focused differential tests, protocol checks where relevant,
affected client/server tests, both typechecks, formatting, and diff checks.

Completed slice: [Shared-core foundation and first leaf](slices/phase-3-pure-shared-core/shared-core-foundation-and-first-leaf.md).

Completed slice: [Chat load-page normalization](slices/phase-3-pure-shared-core/chat-load-page-normalization.md).

Completed slice: [Chat display-tail normalization](slices/phase-3-pure-shared-core/chat-display-tail-normalization.md).

Completed slice: [Regex output-size normalization](slices/phase-3-pure-shared-core/regex-output-size-normalization.md).

Completed slice: [Legacy OpenAI model-alias normalization](slices/phase-3-pure-shared-core/legacy-openai-model-alias-normalization.md).

Completed slice: [Internal-reasoning stripping](slices/phase-3-pure-shared-core/internal-reasoning-stripping.md).

Completed slice: [Agent-preset output references](slices/phase-3-pure-shared-core/agent-preset-output-references.md).

Completed slice: [Punctuation trimming](slices/phase-3-pure-shared-core/punctuation-trimming.md).

Completed slice: [Inlay-token matching](slices/phase-3-pure-shared-core/inlay-token-matching.md).

Completed slice: [ChatML row parsing](slices/phase-3-pure-shared-core/chatml-row-parsing.md).

Completed slice: [History-slot rendering](slices/phase-3-pure-shared-core/history-slot-rendering.md).

Completed slice: [Lore hash randomization](slices/phase-3-pure-shared-core/lore-hash-randomization.md).

Completed slice: [Model-role resolution](slices/phase-3-pure-shared-core/model-role-resolution.md).

Completed slice: [Agent-only lorebook predicate](slices/phase-3-pure-shared-core/agent-only-lorebook-predicate.md).

Completed slice: [Script-model overrides](slices/phase-3-pure-shared-core/script-model-overrides.md).

Active slice: [Module-integration normalization](slices/phase-3-pure-shared-core/module-integration-normalization.md).
