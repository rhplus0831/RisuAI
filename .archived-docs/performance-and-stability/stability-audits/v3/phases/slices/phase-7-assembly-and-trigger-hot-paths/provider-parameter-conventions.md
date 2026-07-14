# Slice: Provider Parameter Conventions

Phase: [7](../../phase-7-assembly-and-trigger-hot-paths.md). Findings:
v4-M4 and v4-L6. Server provider dispatch correctness fix.

## Scope

Preserve SPA request-body conventions when server prompt assembly dispatches
to provider adapters. Disabled numeric controls use the SPA sentinel
`-1000`, which means "omit this parameter" rather than "send a negative
scaled value". Assembled logit-bias rows must either reach the provider
adapter layer intentionally or be removed from assembly and prompt events.

This slice owns server dispatch argument shaping and provider request-body
tests. It does not change provider routing, API key resolution, streaming
transport, prompt message formatting, model capability routing, or unrelated
provider-specific optional parameters. It also does not change UI settings or
`additionalParams` last-word behavior for OpenAI-compatible custom params.

## Anchors

- [`../../../../v4/audit-stability-and-performance-v4.md`](../../../../v4/audit-stability-and-performance-v4.md)
  v4-M4 and v4-L6, plus the routing note pairing them.
- `server/fastify/src/prompt/chatDispatch.ts`: `ChatDispatchArgs`,
  `dispatchChatProvider`, shared `temperature` derivation, and Horde
  `topK`/`topP` forwarding.
- `server/fastify/src/prompt/assemble.ts`: `state.biases`,
  prompt-event `biases`, and final assembly result `biases`.
- Provider request builders under `server/fastify/src/generation/`, especially
  OpenAI-compatible bodies for temperature omission and Horde bodies for
  `topK`/`topP` omission.
- SPA convention reference:
  `src/ts/process/request/shared.ts` (`-1000` disables forwarded
  parameters).
- Focused tests:
  `server/fastify/__tests__/generation.chat.test.ts`,
  `server/fastify/__tests__/openai.test.ts`, and
  `server/fastify/__tests__/horde.test.ts`. If the logit-bias decision keeps
  assembly-side fields, include `server/fastify/__tests__/assemble.test.ts`.

## Target Shape

- Introduce or reuse one dispatch-level normalizer for disabled numeric
  parameters. It should return `undefined` for `-1000`, preserve
  `undefined`/non-finite rejection behavior, and keep the existing scaling and
  provider-name mapping for active values. `0` is an active value unless an
  existing adapter already treated it differently.
- Apply that normalizer to the shared `temperature` path before every
  provider adapter call. No provider request body may receive
  `temperature: -10` when the global BotSettings slider is disabled.
- Apply the same disabled-sentinel omission to Horde `topK` and `topP`.
  Active Horde values must continue to reach the adapter using the existing
  `top_k`/`top_p` wire names. Empty or undefined sampler values remain
  omitted.
- Implementation note: the v4 rider chooses the explicit logit-bias **drop**
  contract for the current server path. Server assembly does not compute or emit
  `biases`, and provider bodies do not include `biases`/`logit_bias`, until a
  future provider-support slice threads tokenized bias rows intentionally.
- Keep the rule reusable for future forwarded sampler parameters so the next
  server dispatch field cannot reintroduce the sentinel drift.
- Decide the logit-bias contract before implementation:
  - If the feature is supported on the server path, thread `state.biases`
    through `ChatDispatchArgs`, convert it to each supported adapter's wire
    shape, and explicitly drop or document unsupported adapters. Pass
    coverage should inspect a serialized provider body, such as an
    OpenAI-compatible `logit_bias` field, and include deterministic token-id
    rows plus an expanded text-bias case if server-side tokenization is
    implemented.
  - If the feature is not supported on the server path, remove the dead
    assembly and prompt-event bias work so the server does not advertise a
    field that dispatch ignores.
- Add provider request-body tests for both disabled and active numeric
  parameters. The disabled cases must assert field absence, not merely a
  clamped value. Examples to preserve: `temperature: 80` still serializes as
  `0.8`; Horde `top_k: 40` and `top_p: 0.9` still serialize as before.
- Add a logit-bias pass/drop test matching the selected contract. A pass test
  should assert the adapter request body receives the assembled rows; a drop
  test should assert assembly no longer emits unused bias rows.
- Keep all existing v3 Phase 7 IDs pending until their own slices land. This
  v4-only slice must not flip L1, L3, L6-L10, or K3.

## Invariants

- Disabled SPA sliders omit provider parameters on the server path.
- Active parameter values preserve the old request-body mapping and scaling.
- Provider adapters do not receive negative sentinel values.
- Empty/undefined sampler values remain omitted, and `additionalParams`
  override ordering is unchanged.
- The server does not compute or emit logit-bias rows that dispatch ignores.
- Unsupported providers have an explicit bias no-op/drop contract rather than
  silent accidental loss.
- This slice does not broaden Phase 7 into send-path polish; v4-L1/v4-L2/v4-L3 and
  v4-L5 remain outside this slice unless separately justified.

## Done Criteria

- OpenAI-compatible request-body coverage proves disabled temperature is
  absent and active temperature is still forwarded correctly.
- Horde request-body coverage proves disabled `topK`/`topP` are absent and
  active `topK`/`topP` are still forwarded correctly.
- A focused logit-bias test proves the selected pass/drop contract.
- Empty bias sets omit provider bias fields, and unsupported adapters send no
  accidental `biases`, `logit_bias`, or provider-specific equivalent field.
- No provider request-body fixture contains `-10`, `-1000`, or another
  disabled sentinel value for a forwarded numeric parameter.
- v4-M4 and v4-L6 proof is recorded without changing v3 active-risk statuses.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/openai.test.ts \
  server/fastify/__tests__/horde.test.ts \
  server/fastify/__tests__/assemble.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
