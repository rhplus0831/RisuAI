# SendChat Fixture Coverage

## Goal

Preserve generation behavior while removing platform branches around the runtime. Fastify-only cleanup should not change sendChat outputs unless a phase explicitly updates the fixture contract.

## Current Expectations

- Existing sendChat fixture coverage remains the guardrail for prompt assembly, provider mocks, memory behavior, commands, and finalization.
- Platform cleanup should be isolated from fixture semantics wherever possible.
- Provider routing changes should be covered in [providers.md](providers.md) before fixture expectations are changed.

## Required Checks

- Run the existing sendChat-focused tests during phases that touch bootstrap, provider routing, memory, commands, or generation server routes.
- Keep fake provider behavior deterministic.
- Record any intentionally changed fixture behavior in the phase closeout.

## Exit Criteria

- Fastify-only runtime cleanup does not create unexplained fixture churn.
- Fixture updates cite the implementation phase and the reason for the expected-output change.
