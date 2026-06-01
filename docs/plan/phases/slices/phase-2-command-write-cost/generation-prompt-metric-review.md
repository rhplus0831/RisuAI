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
  plain send, chat-var side effect, `editinput` transcript rewrite, combined
  input-trigger transcript-plus-chat-var side effect, preview prompt, and
  durable generation.
- Compare `generation_prompt_assembly`, `generation_assembly_persistence`,
  `generation_persistence`, and `command_mutation` for each path.
- Keep this as proof coverage only; do not change runtime persistence behavior
  in this slice.

## Metric Evidence

Latest focused sample from
`RISU_PROTOCOL_METRICS=1 RISU_GENERATION_METRIC_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts -t "reviews representative generation prompt metric families" --reporter verbose`:

| Scenario                            | Prompt DB loads | Assembly persistence       | Command mutation path | Final persistence        |
| ----------------------------------- | --------------: | -------------------------- | --------------------- | ------------------------ |
| plain send                          |               1 | skipped                    | none                  | none                     |
| chat-var side effect                |               1 | `chat.scriptstate.updated` | `targeted-assembly`   | none                     |
| `editinput` transcript rewrite      |               1 | `messages.replaced`        | `targeted-assembly`   | none                     |
| input-trigger transcript + chat-var |               1 | `messages.replaced`        | `targeted-assembly`   | none                     |
| preview prompt                      |               1 | none                       | none                  | none                     |
| durable generation                  |               1 | skipped                    | `targeted-generation` | `generation_persistence` |

Representative timing readout from that run:

| Scenario                            | promptMs | assembly persistence total | command total |
| ----------------------------------- | -------: | -------------------------: | ------------: |
| plain send                          |      148 |                       0.00 |             - |
| chat-var side effect                |        6 |                       4.27 |          3.86 |
| `editinput` transcript rewrite      |       63 |                       4.15 |          3.47 |
| input-trigger transcript + chat-var |       23 |                       3.20 |          2.96 |
| preview prompt                      |        4 |                          - |             - |
| durable generation                  |        3 |                       0.00 |          2.63 |

Timing values are review readouts, not thresholds. The stable finding is the
path classification: assembly-time projected side effects now report
`mutationPath: "targeted-assembly"` after
[`generation-assembly-side-effect-narrow-path.md`](generation-assembly-side-effect-narrow-path.md);
final generation persistence still reports `mutationPath: "targeted-generation"`
and keeps `dbJsonWriteMs: 0`.

## Decision

The selected runtime candidate,
[`generation-assembly-side-effect-narrow-path.md`](generation-assembly-side-effect-narrow-path.md),
is implemented. Continue Phase 2 only if fresh metrics identify another narrow
source area with explicit revision, event, rollback, and proof-command scope.

## Validation

- Passed:
  `RISU_PROTOCOL_METRICS=1 RISU_GENERATION_METRIC_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts -t "reviews representative generation prompt metric families" --reporter verbose`
