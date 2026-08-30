# Regex Output-Size Normalization

Status: complete at `83e8aabfa`.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core chat display-tail leaf at `6fc15d7a1`.

## Objective

Move the browser/Node-neutral regex output-size default, bounds, normalizer, and
MiB-to-code-unit conversion into the audited shared-core owner without changing
settings persistence, command validation, or regex execution budgets.

## Source And Destination

- Source: `src/ts/regexOutputSizeLimit.ts`.
- Destination: an explicit `@risuai/shared-core` subpath.
- Consumers: Fastify database defaulting, advanced-setting validation, bounded
  regex and script execution, plus browser storage, advanced settings, script
  execution, and the regex worker runtime.

## Behavior Contract

- Preserve default `16`, minimum `1`, and maximum `64` MiB.
- Preserve numeric-only input, non-finite fallback, `Math.trunc` behavior,
  bounds clamping, and the `1024 * 1024` code-unit multiplier exactly.
- Do not change the persisted setting key, command rejection behavior,
  revisions, events, resource payloads, regex timeout policy, worker messages,
  or output truncation/error behavior.

## Validation

Shared-core import audit and typecheck, focused differential fixtures,
storage/settings/defaulting/command/bounded-regex/script/worker owning tests,
both typechecks, architecture inventory, formatting, and `git diff --check`.

## Done When

- Every production browser and Fastify consumer uses the shared subpath.
- The browser-tree implementation is deleted and all matching cross-runtime
  edges disappear without a new exception.
- Numeric validation, truncation, clamping, code-unit budgets, persistence, and
  regex execution tests pass unchanged.

Stop if the helper needs a regex engine, worker, browser state, persistence,
command, or host-specific dependency.

## Result

The constants, numeric normalizer, and code-unit conversion now live at
`@risuai/shared-core/regex-output-size-limit`. All eight production consumers
use the shared owner, the old browser-tree module is gone, focused execution and
validation tests preserve existing budgets, and the reviewed boundary fell to
330 direct root-`src` edges.
