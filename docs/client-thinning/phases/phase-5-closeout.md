# Phase 5: Closeout

Date: 2026-05-29

Status: blocked until the phase-4 chat-process ownership work lands.

## Exit Criteria

- Every blocker **A**-item (A1 prompt-assembly content parity, A2 post-generation
  durable derivation) is resolved server-side or explicitly classified
  unsupported — never a silent browser fallback.
- **Group-chat legacy removal** is done: removed from the client, not merely
  unsupported under server assembly.
- **Audit-rule hardening** is done: the four empirically-defeated rules (`A4R2`,
  `A4R7`, the fanout `.svelte` path, `EC2`) are converted from string/regex to
  AST invariants, each with an adversarial fixture.
- **Event patching** is either shipped behind a closed SSE reconnect/replay gap
  (reconnect + Last-Event-ID replay) or explicitly still deferred.
- Latest verification is recorded in
  [`../coverage/latest-verification.md`](../coverage/latest-verification.md), and
  the status/coverage shards match current source.

See [`../plan.md`](../plan.md) for the spine.
