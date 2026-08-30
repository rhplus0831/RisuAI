# Module/Trigger Descriptor Ownership

Status: complete at `5431a9921` and `ba09370c0`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: trigger-compatibility policy at `68d41f2cd`.

## Objective

Replace the bounded Fastify imports of browser module and trigger descriptors
with closed server-owned structural contracts.

## Boundary

- Production: module collection, scripts, triggers, trigger data effects, and
  trigger-source attribution.
- Tests: lorebook, Lua runtime, module, module memo, and trigger fixtures.
- Delivered delta: eight production and six server-test type-only root-`src`
  edges; 227 total edges became 213.

## Behavior Contract

Preserve the full trigger condition/effect discriminated unions, active-module
ordering and deduplication, WeakMap cache identity/invalidation, module content
extraction order, inherited low-level access, shallow trigger clones,
non-enumerable source attribution, mode/manual filtering, recursion and abort
budgets, unsupported-effect no-ops, and message/variable mutation semantics.

Aggregate database/chat/character contracts and activation runtime helpers were
not included. `luaRuntime.ts`'s trigger descriptor moved with the exact closed
trigger union; its adjacent character argument import remains open.

## Validation

Trigger descriptors passed 2 ownership/parity, 4 structure, 143 trigger, 52
Lua, and 11 module tests. Module descriptors passed 2 ownership/parity, 11
module, 6 memo, 58 script, 79 lorebook, 52 Lua, and 143 trigger tests. Both
typechecks, the 213-edge architecture inventory, formatting, and diff checks
passed.
