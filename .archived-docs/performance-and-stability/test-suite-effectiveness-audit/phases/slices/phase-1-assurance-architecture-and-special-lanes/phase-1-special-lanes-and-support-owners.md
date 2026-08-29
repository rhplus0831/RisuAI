# P01-S03: Special Lanes And Support Owners

Date: 2026-08-29

Status: Complete.

## Special-Lane Owner Map

| Evidence | Exact owner | Ordinary / aggregate / CI disposition |
| --- | --- | --- |
| UI coverage | 6 files / 203 cases | Ordinary standalone frontend; excluded from `test:all` ordinary frontend and executed once in the required coverage lane/job. |
| Frontend performance | 2 files / 6 cases | Excluded from ordinary frontend; isolated single-worker aggregate and CI gate. |
| Server load cost | 38-case harness plus domain communication-cost suites | Normal server discovery; server lane isolated from concurrent aggregate load. |
| Initial preload | 9-case bundle oracle, 4-case byte oracle, and real build report | Unit owners in frontend; real build/report is the documented CI-only superset. |
| Browser smoke | 7 specs / 34 cases / 4 screenshot baselines | Required standalone, aggregate, and CI lane with Phase 7 artifacts retained. |
| Realm scale | 1 direct 7,000-asset case | Named isolated local aggregate and required CI owner; ordinary server retains one intentional skip. |
| Compatibility | 16 current cells + 2 cluster regressions; pinned baseline/diff goldens | Current-only command is green; full differential remains blocked by the exact missing external worktree. |

## Exhaustive Support Dispositions

The checked support manifest is the exact owner list; every row is covered by
the group disposition below rather than duplicated into a second hand-maintained
file list.

| Manifest group | Count | Disposition |
| --- | ---: | --- |
| Runner/config/CI | 30 | Keep; discovery, setup, affected selection, aggregate, package manager, workflow, and three linked manifests are directly checked. |
| Performance-budget tooling | 4 | Keep; oracle tests and the real build gate protect graph, path, report, and threshold semantics. |
| Compatibility harness | 13 | Keep; current/cluster evidence is runnable, mismatch actuals persist, and baseline/diff owners stay pinned and blocked rather than refreshed. |
| Prompt fixture corpus | 130 | Keep as consumed fixture owners; semantic product dispositions belong to Phases 6-7, while update governance forbids blind refresh. |
| Shared helper/harness | 71 | Keep 70; defer only `resourceDatabase.ts` as the explicit migration adapter in `TSA-P01-017`. |
| Snapshots/screenshots | 5 | Keep; four visual baselines and the remaining snapshot owner have named browser/product consumers and intentional-update rules. |
| Mixed production test seams | 65 | Keep as declared test seams with consumer/rationale ownership; the previously omitted memory-embedding seam is now included. |

Repository-wide symbol proof removed the stale exports recorded in
`TSA-P01-016`; no standalone helper file became orphaned. New support or mixed
seams make the manifest check fail until deliberately classified.

## Evidence Bounds

- The resource adapter composes converged public resource reads and does not
  prove the bootstrap response shape.
- Browser smoke proves deterministic built-stack journeys but excludes live auth
  UI, external providers, production refresh timing, workers, and asset GC.
- The Happy-DOM fetch guard blocks accidental loopback port 3000 access; it is
  not a general outbound network sandbox.
- Frozen RisuSave legacy vectors are independent of the current encoder;
  current-codec round trips remain separate consistency evidence.
