# Upstream Sync

This directory tracks porting of upstream RisuAI (`kwaroran/Risuai`) changes
into this Fastify fork. The fork diverged from upstream at merge-base
`71c476e9c` (2026-05-18) and has rewritten the storage, request, and much of
the processing layer, so upstream changes are ported **by behavior, not by
patch**.

## Why not cherry-pick

Measured on the 2026-08-07 sweep range (189 non-merge upstream commits):
an in-memory test cherry-pick (`git merge-tree`) applied cleanly for only
4 of 189 commits, all trivia. 68 commits touch files this fork deleted.
Treat the upstream diff as the **specification**, never as the patch:
read it, write down the behavior (user-visible change, data shapes, edge
cases, storage/schema changes), then implement natively against this fork's
architecture (see `STRUCTURE.md` and `docs/structure/`).

## Conventions

- **Remote**: `upstream` → `https://github.com/kwaroran/Risuai.git`.
- **Base marker**: local branch `upstream-sync-base` points at the last
  upstream commit whose range has been fully dispositioned (every unit
  ported or explicitly ruled N/A). Advance it only when a sweep's ledger
  has no `pending` rows left, then start the next sweep from it.
- **Unit**: one first-parent commit on `upstream/main` (squashed PRs and
  direct pushes are each one unit; a direct merge commit can bundle several
  PRs — split it into sub-items in the ledger).
- **Traceability**: every fork commit that ports an upstream unit carries a
  trailer `Ported-from: <upstream-sha>` (add the PR number in the subject or
  body when there is one). This is what lets future sweeps skip covered work.
- **Verdicts**:
  - `PORT` — reimplement natively; ledger records the fork commit when done.
  - `N/A` — subsystem not live in this fork (Tauri, Drive/account sync,
    cold storage, upstream self-host/CI), already covered by an existing
    fork mechanism, upstream-internal churn (version bumps), or reverted
    upstream within the range.
  - `INVESTIGATE` — needs a diff-level look before the verdict is final.
  - `DONE <fork-sha>` — ported and verified.

## Sweep procedure

1. `git fetch upstream`.
2. Enumerate units:
   `git rev-list --first-parent --reverse upstream-sync-base..upstream/main`.
3. For each unit, record subject, touched files, and whether files survive
   in the fork; optionally test-apply with
   `git merge-tree --write-tree --merge-base=<c>^1 HEAD <c>` (exit 0 = clean).
4. Triage into the verdict table (new dated `sweep-*.md` file here).
5. Port `PORT` units oldest-first within a family (later upstream commits
   amend earlier ones; the net effect of feat+revert chains is what gets
   ported, not each step).
6. When the ledger is fully dispositioned, advance `upstream-sync-base`.

## Sweeps

| Sweep | Range | Status |
| --- | --- | --- |
| [2026-08-07](sweep-2026-08-07.md) | `71c476e9c..f3f0242fb` (85 units) | nearly complete — only u3, u10, u82 remain; F1 + u81b skipped |
