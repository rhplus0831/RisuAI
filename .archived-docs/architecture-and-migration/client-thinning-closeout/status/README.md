# Client Thinning Status Shards

Date: 2026-05-29

Router for the `status/` shards. Open only the one for the behavior being
changed; the codebase is the source of truth.

- [`overview.md`](overview.md) — current phase language and main code entry points.
- [`next-steps.md`](next-steps.md) — prioritized work order for the next batch.
- [`sendchat-thinning.md`](sendchat-thinning.md) — the detailed chat-process
  ownership triage (A hard blockers / B fine-in-browser, per branch).
- [`server-projection.md`](server-projection.md) — bootstrap, projection guard,
  and events (event patching deferred).
- [`audit.md`](audit.md) — audit rules; reproducibility done, four defeated rules
  hardened, remaining shallow-rule work conditional.
- [`command-boundaries.md`](command-boundaries.md) — command contract and
  resource families (closed/stable).
- [`assets-imports-backups.md`](assets-imports-backups.md) — asset routes,
  `.risu` import/export/bundle, backup/restore (closed/stable).
- [`client-owned-unsupported.md`](client-owned-unsupported.md) — B1 keep in the
  browser; group chat is legacy and to be removed.

## Verification Coverage

The former `coverage.md` router and `coverage/README.md` landing page are
consolidated here. Detailed proof now lives under the **Verification Coverage**
section of each status shard; the latest aggregate run remains a separate
record.

Date: 2026-05-29

Router for client-thinning proof. Open only the status record for the surface
being changed. Coverage proves implemented or historical behavior — it does not
widen runtime support.

- [`latest-verification.md`](../latest-verification.md) — the
  latest verification batch commands and results (do not edit unless a new
  verification was run).
- [`audit.md`](audit.md#verification-coverage) — `pnpm client-thinning:audit`,
  structural rules, fixture proof, and the rule-hardening caveat.
- [`command-boundaries.md`](command-boundaries.md#verification-coverage) — command routes, helpers,
  revision/active-writer behavior (closed).
- [`server-projection.md`](server-projection.md#verification-coverage) — bootstrap, projection
  guard, event refresh (event patching deferred).
- [`assets-imports-backups.md`](assets-imports-backups.md#verification-coverage) —
  assets, `.risu` import/export/bundle, backup/restore (closed).
- [`sendchat-thinning.md`](sendchat-thinning.md#verification-coverage) — prompt
  assembly, server chat SSE, provider routing, post-generation branches.
- [`client-owned-unsupported.md`](client-owned-unsupported.md#verification-coverage) — known thin spots and
  intentionally-thin proof.
