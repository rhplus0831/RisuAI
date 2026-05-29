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
