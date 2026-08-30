# Module/Trigger Descriptor Ownership

Status: ready.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: trigger-compatibility policy at `68d41f2cd`.

## Objective

Replace the bounded Fastify imports of browser module and trigger descriptors
with closed server-owned structural contracts.

## Boundary

- Production: module collection, scripts, triggers, trigger data effects, and
  trigger-source attribution.
- Tests: lorebook, Lua runtime, module, module memo, and trigger fixtures.
- Expected delta: seven production and six server-test type-only root-`src`
  edges; 227 total edges become 214.

## Behavior Contract

Preserve the full trigger condition/effect discriminated unions, active-module
ordering and deduplication, WeakMap cache identity/invalidation, module content
extraction order, inherited low-level access, shallow trigger clones,
non-enumerable source attribution, mode/manual filtering, recursion and abort
budgets, unsupported-effect no-ops, and message/variable mutation semantics.

Do not include aggregate database/chat/character contracts, activation runtime
helpers, or `luaRuntime.ts`'s adjacent trigger/character argument imports.

## Validation

Run module, module memo, trigger, lorebook, Lua-runtime, script, and closed
ownership suites; run both typechecks, architecture inventory, formatting, and
diff checks.
