# Coverage

Date: 2026-05-29

Router for client-thinning proof. Keep detailed inventories in the `coverage/`
shards; open only the one for the surface being changed. Coverage proves
implemented or historical behavior — it does not widen runtime support.

- [`coverage/latest-verification.md`](coverage/latest-verification.md) — the
  latest command and result (do not edit unless a new verification was run).
- [`coverage/audit.md`](coverage/audit.md) — `pnpm client-thinning:audit`,
  structural rules, fixture proof, and the rule-hardening caveat.
- [`coverage/commands.md`](coverage/commands.md) — command routes, helpers,
  revision/active-writer behavior (closed).
- [`coverage/projection.md`](coverage/projection.md) — bootstrap, projection
  guard, event refresh (event patching deferred).
- [`coverage/assets-imports-backups.md`](coverage/assets-imports-backups.md) —
  assets, `.risu` import/export/bundle, backup/restore (closed).
- [`coverage/sendchat-generation.md`](coverage/sendchat-generation.md) — prompt
  assembly, server chat SSE, provider routing, post-generation branches.
- [`coverage/missing-thin.md`](coverage/missing-thin.md) — known thin spots and
  intentionally-thin proof.
