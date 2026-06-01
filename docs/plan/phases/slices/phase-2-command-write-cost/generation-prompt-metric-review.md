# Generation Prompt Metric Review

Status: implemented on 2026-06-01.

## Source Anchors

- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/prompt/assemble.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/messageStore.ts`
- `server/fastify/__tests__/generation.chat.test.ts`

## Scope

Review the generation/prompt protocol metrics added by
[`generation-prompt-side-effect-measurement.md`](generation-prompt-side-effect-measurement.md)
before selecting a runtime optimization.

Selected batch:

- Exercise representative generation paths under `RISU_PROTOCOL_METRICS=1`:
  plain send, chat-var side effect, `editinput` transcript rewrite, preview
  prompt, and durable generation.
- Compare `generation_prompt_assembly`, `generation_assembly_persistence`,
  `generation_persistence`, and `command_mutation` for each path.
- Keep this as proof coverage only; do not change runtime persistence behavior
  in this slice.

## Metric Evidence

Latest focused sample from
`RISU_PROTOCOL_METRICS=1 RISU_GENERATION_METRIC_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts -t "reviews representative generation prompt metric families" --reporter verbose`:

| Scenario                       | Prompt DB loads | Assembly persistence       | Command mutation path | Final persistence        |
| ------------------------------ | --------------: | -------------------------- | --------------------- | ------------------------ |
| plain send                     |               1 | skipped                    | none                  | none                     |
| chat-var side effect           |               1 | `chat.scriptstate.updated` | `hydrated`            | none                     |
| `editinput` transcript rewrite |               1 | `messages.replaced`        | `hydrated`            | none                     |
| preview prompt                 |               1 | none                       | none                  | none                     |
| durable generation             |               1 | skipped                    | `targeted-generation` | `generation_persistence` |

Representative timing readout from that run:

| Scenario                       | promptMs | assembly persistence total | command total |
| ------------------------------ | -------: | -------------------------: | ------------: |
| plain send                     |      106 |                       0.00 |             - |
| chat-var side effect           |        3 |                       3.29 |          3.04 |
| `editinput` transcript rewrite |       38 |                       3.08 |          2.99 |
| preview prompt                 |        2 |                          - |             - |
| durable generation             |        2 |                       0.00 |          2.47 |

Timing values are review readouts, not thresholds. The stable finding is the
path classification: assembly-time projected side effects still route through
`applyJsonCommandMutation` and therefore report `mutationPath: "hydrated"`;
final generation persistence reports `mutationPath: "targeted-generation"` and
keeps `dbJsonWriteMs: 0`.

## Decision

The next runtime candidate is
[`generation-assembly-side-effect-narrow-path.md`](generation-assembly-side-effect-narrow-path.md):
move eligible assembly-time chat scriptstate and transcript-rewrite persistence
off the generic hydrated command path while preserving the current revision and
event contract.

## Validation

- Passed:
  `RISU_PROTOCOL_METRICS=1 RISU_GENERATION_METRIC_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts -t "reviews representative generation prompt metric families" --reporter verbose`
