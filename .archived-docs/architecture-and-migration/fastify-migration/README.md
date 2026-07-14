# Fastify Migration Archive

Archive of the Fastify migration documentation (Phases 0–9 and the
standing client-thinning workstream). The migration is closed; the
Fastify server is the only supported runtime.

## Layout

- [`client-thinning/`](client-thinning/) — the standing server-projection
  contract. Invariant, exit criteria, decision rationale, and the Phase 9
  command map.
- [`phases/`](phases/) — substantive scope/design documents for the ten
  migration phases plus the Fastify-only lockdown follow-up.
- [`other/`](other/) — top-level migration design docs: plan,
  architecture, runtime stages, removed/out-of-scope registry, test
  coverage, and the per-provider design deferrals.

## What was dropped

Progress-tracking artifacts were removed in this archive pass:

- `status.md`, `status/*.md`, and the dated historical status logs.
- Per-alpha `audit.md`, `open-findings.md`, `closeout-buckets.md`,
  `history.md`, and `final-audit.md`. The substantive contract content
  was merged into [`client-thinning/README.md`](client-thinning/README.md)
  and [`client-thinning/decisions.md`](client-thinning/decisions.md).
- Per-slice closeout logs (`phase-N-*-{letter}.md`, dated slice files,
  `*-followup.md`, `*-scope.md` redirect wrappers).
- Source audits that seeded specific alpha workstreams
  (`history/audit-*.md`, `history/handover.md`).

## Conventions

- Dates throughout are absolute (`YYYY-MM-DD`), never relative.
- Source-file citations use `path:line`.
- Mentions of non-Fastify runtimes (legacy local mode, Tauri, Hono,
  service worker, etc.) are historical no-port references unless
  explicitly stated otherwise.
