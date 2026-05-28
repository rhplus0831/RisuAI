# Next Steps

Date: 2026-05-28

Read this when choosing the next client-thinning batch.

## Start Point

- Run `pnpm client-thinning:audit`.
- If the audit is red, fix or explicitly triage the audit before selecting
  wider runtime work.
- If the audit passes, record the latest result in
  `../coverage/latest-verification.md`.
- Before editing runtime code, write a compact scope: invariant, owner, timing,
  inputs, allowed mutations, persistence, errors, rollback, active-writer
  behavior, projection refresh behavior, and proof command.

## Current Best Targets

1. Audit fixture reproducibility: add committed pre-fix fixtures and tests for
   audit rules so each invariant is demonstrably red on the regression class.
2. Audit maintainability only where it supports fixture coverage. Keep one
   `pnpm client-thinning:audit` entry point.
3. One command/projection hardening family if source inventory reveals a live
   bug: active writer, command id minting, fan-out, conflict replay, projection
   writes, asset references, backup inventory, or bounded accumulators.
4. One sendChat thinning branch if the batch names the exact default-screen,
   local prompt, server-backed replay, or post-generation branch, the server
   replacement contract, and proof.
5. Documentation-only reconciliation when code and docs drift but runtime
   behavior does not need to change.

## No-Port Or Blocked

- Do not broaden the task into all client thinning at once.
- Do not remove active legacy-named routes just because the name says legacy.
- Do not add browser provider fallback in Fastify mode.
- Do not reopen native/mobile wrappers, service workers, group chat, peer sync,
  Drive sync, Risu Account Sync, or removed memory engines.
- Do not add server-side plugin code execution.

## Closed Areas

Treat these as closed unless current source inventory proves drift:

- Command foundation and major resource command families.
- Bootstrap projection and command-event invalidation.
- Server `.risu` import/export/bundle routes.
- Asset-byte routes and asset-reference validation baseline.
- Backup/restore coverage of known server-owned data directory children.
- Provider secret masking baseline.
- Fastify provider dispatch for supported provider shapes.

## Selection Order

1. Fix or prove the audit baseline.
2. Make audit rules reproducible through fixtures/tests.
3. Close one source-proven invariant drift.
4. Remove one named browser branch with server proof.
5. Update docs after the code and proof are complete.
