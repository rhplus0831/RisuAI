# Message-generation parity audit — evidence documents

Recorded 2026-08-02 from a six-agent review of the Fastify message-generation
flow against the original client-side implementation. The review ran after
commit `5f4109fee` (script message-index fix) to find remaining behavioral
incompatibilities across the whole generation pipeline.

## Baseline

The comparison baseline is the upstream fork point, commit `71c476e9c`
(last merge of `kwaroran/Risuai` main, 2026-05-18). Original-side references
are written `src/ts/...@71c476e9c`. To browse the baseline tree:

```bash
git worktree add --detach /tmp/risuai-baseline 71c476e9c
```

Do NOT compare against a newer upstream checkout — upstream is 168+ commits
past the fork point and produces false positives for post-fork features.

## Finding record format

Each finding has a stable ID (`<AREA>-<n>`), a severity, and:

- **Verification** — `code-verified` (a maintainer re-checked the claim in
  source on 2026-08-02), `cross-confirmed` (two agents found it independently),
  or `agent-reported` (single agent; re-verify before working on it).
- **Classification** — `BUG` (unintended incompatibility), `UNCLEAR`
  (divergence acknowledged somewhere but not documented as a supported
  incompatibility; needs a product decision), or `INTENTIONAL` (pinned by a
  test or structure document; listed for the record, no work item).

All file:line references were taken at commit `fbf750b24` and are
point-in-time evidence — re-verify against current code before starting work.

## Documents

| Document | Area | ID prefix |
| --- | --- | --- |
| [prompt-assembly.md](prompt-assembly.md) | Template ordering, static sections, token budgeting | `PA` |
| [history-cbs-variables.md](history-cbs-variables.md) | History formatting, CBS parser, chat variables, prompt assets | `HC` |
| [scripts-triggers-lua.md](scripts-triggers-lua.md) | Regex scripts, V1/V2 triggers, Lua scripting | `ST` |
| [lorebook-memory.md](lorebook-memory.md) | Lorebook activation, Hypa V3 / memory systems | `LM` |
| [provider-adapters.md](provider-adapters.md) | Provider request/response wire parity | `PR` |
| [orchestration-postgen.md](orchestration-postgen.md) | sendChat orchestration, retries, post-generation, persistence | `OR` |

Work items, statuses, and execution order live in
[../WORK-INDEX.md](../WORK-INDEX.md). Findings classified `INTENTIONAL` appear
in a dedicated section at the end of each document and have no work items.
