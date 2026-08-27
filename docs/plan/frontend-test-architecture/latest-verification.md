# Frontend Test Architecture Verification

Date: 2026-08-28

## State

Provisional planning baseline. This is not the Phase 0 closeout record and does
not authorize migration to the proposed project topology.

## Environment

- Repository: `/home/codex/risuai-fastify`
- Node: 24.19.0
- Vitest: 4.1.2
- Available CPUs: 10
- Frontend test-all UI-map exclusion: `RISU_TEST_EXCLUDE_UI_MAP=true`

## Correctness Run

Command:

```sh
pnpm test:all
```

Result:

- Passed in 210.11s wall time.
- Frontend: 528 files, 6,408 tests, 80.11s Vitest duration.
- Focused UI coverage: 6 files, 203 tests, 19.15s Vitest duration.
- Server: 154 files, 3,295 passed and 1 skipped.
- Browser smoke: 34 passed.
- Frontend performance gates: 2 files, 6 tests, 12.51s Vitest duration.
- Typecheck, Svelte check, and formatting lanes passed.

## Standalone Frontend Profile

Command shape:

```sh
RISU_TEST_EXCLUDE_UI_MAP=true pnpm exec vitest run \
  --reporter=json --outputFile=/tmp/frontend-profile.json
```

Measured with GNU `time`:

- Wall time: 75.13s.
- User time: 445.70s.
- System time: 39.42s.
- Average CPU: 645%.
- Peak RSS: 4,822,384 KiB.
- Result: 528 files and 6,408 tests passed.

The corresponding aggregate `test:all` frontend report recorded:

| Phase | Aggregate duration |
| --- | ---: |
| Transform | 129.94s |
| Setup | 31.05s |
| Import | 485.51s |
| Test bodies | 88.89s |
| Environment | 60.69s |

These values accumulate across parallel workers and do not add to wall time.

## Node Project Probe

Command:

```sh
RISU_TEST_EXCLUDE_UI_MAP=true pnpm exec vitest run --project frontend-node
```

Result:

- 124 files and 766 tests passed.
- Vitest duration: 3.08s.
- Wall time: 3.92s.
- Peak RSS: 978,176 KiB.

## Isolation Probe

A diagnostic Happy-DOM run with `--no-isolate` leaked mocks/state across files
and attempted DNS resolution for test-only `auth.example` and `mcp.example`
hosts. The run was interrupted and the option rejected as a global strategy.

## Formal Phase 0 Requirements

Before replacing this record:

- run at least three warm standalone frontend measurements and report median and
  range;
- record one separately labeled cold-cache measurement;
- capture the exact discovered file-to-project map;
- capture test count, wall time, Vitest phases, CPU, and peak RSS;
- run the Node and Happy-DOM projects independently;
- run the focused UI coverage lane;
- run `pnpm test:all` once with all lanes passing;
- record the commit and working-tree state used for measurement.
