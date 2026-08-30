# Chat-Variable Backend Ownership

Status: complete at `e823b18f7`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Give Fastify prompt/CBS execution a request-local chat-variable registry rather
than importing the browser global registry.

## Boundary And Contract

Preserve scoped chat/global variable reads and writes, missing-value behavior,
and prompt bootstrap ordering. Browser state remains browser-owned; Fastify
owns only the backend required by its request scope. Delivered delta: three
production runtime/mixed root-`src` edges; 190 total edges became 187.

## Verification

Backend behavior/ownership, prompt variables, and prompt bootstrap passed 2,
1, 33, and 6 tests. Both typechecks, the 187-edge inventory, formatting, and
diff checks passed.
