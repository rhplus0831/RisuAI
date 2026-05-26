# Next Steps

Date: 2026-05-27

All Phases 0-9 are closed. No open findings remain. The source of
truth for current state is [`../status.md`](../status.md).

Policy: no actual Fastify users exist yet. Update current schemas,
commands, and import paths directly.

## How to Start New Work

1. Record a new finding in [`../status.md`](../status.md).
2. Create a focused phase file under [`../phases-completed/`](../phases-completed/)
   (or reopen under a new `phases/` file if the scope is large).
3. Each slice should leave the worktree reviewable with focused tests.

## Verification Commands

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

## References

- Current status: [`../status.md`](../status.md)
- Phase 9 command map: [`../phases-completed/phase-9-command-map.md`](../phases-completed/phase-9-command-map.md)
- Phase archive: [`../phases-completed/`](../phases-completed/)
