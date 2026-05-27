# Fastify-Only SendChat Status

## Current State

Fastify-only cleanup should preserve sendChat and generation behavior. The main risk is indirect: provider, proxy, bootstrap, or storage cleanup can change the runtime path used by generation flows.

## Target State

- SendChat fixtures remain stable unless a phase explicitly changes expected behavior.
- Provider IO uses Fastify proxy routes only.
- Generation server routes remain covered by Fastify route tests.
- Memory and command behavior continue to run through the Fastify-backed contract.

## Watch Points

- Run fixture tests when touching provider routing, memory, commands, or generation finalization.
- Record any expected fixture changes in the matching phase closeout.
- Keep provider routing changes covered in [../coverage/providers.md](../coverage/providers.md).
