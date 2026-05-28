# Coverage

Date: 2026-05-28

This file is the coverage router for client thinning. Keep detailed
inventories in `coverage/` shards so agents can load only the proof relevant to
the behavior they are changing.

Coverage documents prove implemented or historical behavior; they do not expand
runtime support beyond the current workstream plan.

## Latest Verification

- Latest recorded verification lives in
  [`coverage/latest-verification.md`](coverage/latest-verification.md).
- Do not edit that file unless a new verification was actually run.
- When updating it, delete the previous result and keep only the latest result.

## Coverage Shards

| Read when checking...                                                                                         | Open                                                                       |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `pnpm client-thinning:audit`, structural rules, and audit fixture/test work                                   | [`coverage/audit.md`](coverage/audit.md)                                   |
| Command routes, browser command helpers, revision handling, command events, active writer                     | [`coverage/commands.md`](coverage/commands.md)                             |
| Bootstrap projection, read-only refresh, projection guard, event refresh                                      | [`coverage/projection.md`](coverage/projection.md)                         |
| Asset references, asset reads/uploads, `.risu` import/export/bundle, backup/restore                           | [`coverage/assets-imports-backups.md`](coverage/assets-imports-backups.md) |
| sendChat prompt assembly, server chat SSE, provider routing, generation persistence, post-generation branches | [`coverage/sendchat-generation.md`](coverage/sendchat-generation.md)       |
| Known thin spots, deferred coverage, and intentionally thin proof                                             | [`coverage/missing-thin.md`](coverage/missing-thin.md)                     |

## Maintenance Rules

- Check the relevant shard before adding tests; avoid replaying already pinned
  behavior.
- Keep inventories grouped by invariant owner, not implementation file.
- If a test proves new behavior, update the smallest relevant shard instead of
  expanding this router.
