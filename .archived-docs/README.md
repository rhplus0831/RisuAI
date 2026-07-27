# Archived Documentation

Completed workstreams, dated audits, and historical decision records. These
documents explain how the current Fastify-only codebase arrived at its present
shape; they are not the source of current behavior. Start with
[`../STRUCTURE.md`](../STRUCTURE.md) for current navigation, and prefer the
codebase whenever an archived line number or contract has drifted.

## Topics

| Topic                                                              | Contents                                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| [Architecture and migration](architecture-and-migration/README.md) | Fastify migration history, client-thinning closeout, and dated original-versus-Fastify behavior audit.                            |
| [Protocol and persistence](protocol-and-persistence/README.md)     | Server/client protocol audits, SQLite migration, projection work, asset coercion, mutation narrowing, and writer takeover.         |
| [Performance and stability](performance-and-stability/README.md)   | Frontend clone narrowing and the four chronological stability/performance audits.                                                 |
| [Generation and models](generation-and-models/README.md)           | Durable generation, translation decisions, chat-scoped settings, Agent Presets, model profiles, and prompt-template ownership.    |
| [UI and user input](ui-and-user-input/README.md)                   | Visible-state and persistence audits, input hooks, chat/settings controls, stale-state reviews, and input hardening.               |
| [Deferred work](deferred-work/README.md)                           | The consolidated deferred-feature inventory/progress record and the older Fastify leftover snapshot.                              |
| [July 23 audit scopes](audit-scopes-2026-07-23/README.md)          | Closed cross-cutting audit charters, verification records, and the plans implemented on 2026-07-23.                                |

## Archive Conventions

- Related workstreams are grouped by topic, while their internal phase and
  slice structure remains intact.
- Chronological audit versions, plans, statuses, and phase records remain
  separate because they describe different points in time or different
  document roles.
- Redundant evidence/progress pairs and parallel audit lenses were consolidated
  into canonical files. Each merged file labels its historical sections and
  states which later section supersedes earlier verdicts.
- The v1-v3 stability/performance audit and active-risk Markdown files remain
  live completeness-gate fixtures even though they are archived guidance.
- Active plans, when present, live under `docs/plan/`; archived TODO language is
  not an active backlog unless a current plan explicitly reopens it.

## Deferred Records

[`deferred-work/deferred-features.md`](deferred-work/deferred-features.md)
combines the June 2026 inventory with its disposition tracker.
[`deferred-work/leftover.md`](deferred-work/leftover.md) is an older historical
snapshot and should not be read as current work.
