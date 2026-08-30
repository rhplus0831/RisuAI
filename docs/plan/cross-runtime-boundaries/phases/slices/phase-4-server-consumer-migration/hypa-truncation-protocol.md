# Hypa Truncation Protocol

Status: complete at `d82d1b86b`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move the Hypa context-truncation confirmation-required error code to the
browser-safe protocol owner.

## Boundary And Contract

Preserve the exact wire string and acknowledgement/retry flow. Delivered delta:
one production runtime edge; 198 total edges became 197.

## Verification

Protocol behavior/ownership, browser server-chat/send-preview, and Fastify chat
generation suites passed 1, 1, 76, 38, and 181 tests. Both typechecks, the
197-edge inventory, formatting, and diff checks passed.
