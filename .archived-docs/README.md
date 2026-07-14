# Archived Documentation

Completed workstreams, dated audits, and historical decision records. These
documents explain how the current Fastify-only codebase arrived at its present
shape; they are not the source of current behavior. Start with
[`../STRUCTURE.md`](../STRUCTURE.md) for current navigation, and prefer the
codebase whenever an archived line number or contract has drifted.

## Topics

| Topic                                                              | Contents                                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| [Architecture and migration](architecture-and-migration/README.md) | Fastify migration history and the later client-thinning closeout.                                                                 |
| [Protocol and persistence](protocol-and-persistence/README.md)     | Server/client ownership and protocol audits, SQLite migration, lazy projection, protocol hardening, and mutation-range narrowing. |
| [Performance and stability](performance-and-stability/README.md)   | Frontend clone narrowing and the four chronological stability/performance audits.                                                 |
| [Generation and models](generation-and-models/README.md)           | Durable generation, chat-scoped settings, Agent Presets, model profiles, prompt-template ownership, and generation observability. |
| [UI and user input](ui-and-user-input/README.md)                   | Visible-state contracts and audits, persistence audits, stale-state reviews, and user-input hardening.                            |
| [Deferred work](deferred-work/README.md)                           | The consolidated deferred-feature inventory/progress record and the older Fastify leftover snapshot.                              |

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
