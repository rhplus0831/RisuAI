# Maintenance Scheduling Acceptance

Final implementation and isolated measurement: `864441bfef4a09c8fdec00b677ff8bf924d88853`.
[Original fixture and budgets](maintenance-baseline.md),
[all final samples](maintenance-costs-after.json), and
[retained failed/diagnostic comparisons](maintenance-investigation.json).

The exact final command passes both tests:

```sh
RISU_MAINTENANCE_COSTS=1 RISU_MAINTENANCE_COST_REPETITIONS=3 pnpm test -- server/fastify/__tests__/maintenanceCosts.test.ts
```

Node 24.19.0, Linux, AMD Ryzen 9 9950X with ten visible CPUs; one warmup and
three measured repetitions per size. Fresh temporary files use real SHA-256 IDs,
one KiB per asset, half referenced/half old orphans, 2/20/200 characters with
2 chats and 10 inlay-bearing messages each, and a 928-byte compatibility save.
The original prose said 896 bytes in error; its raw artifact and unchanged
fixture both contain 928 bytes. OS page cache is not flushed. Other agent tests
were stopped during the final run; the optional V8 observer was disabled.

An authenticated constant-size inlay GET and a setImmediate heartbeat run
continuously, exactly as in the original measurement. All nine measured samples
are retained. SQLite's online-backup await is marked separately. Post-snapshot
work includes reference scanning, worker startup/copy/hash/drain, directory
extras, scratch cleanup and manifest publication. Recursive `cp` counters are
zero because copies now run in bounded native-worker batches; this does not
mean copying is free. Retention is tested separately from `createBackup`.

| Assets | Backup median max event-loop gap / API delay, before → after (ms) | GC median max event-loop gap / API delay, before → after (ms) |
| --- | --- | --- |
| 20 | 1.270 / 1.468 → 2.462 / 2.976 | 1.104 / 1.676 → 2.170 / 0.880 |
| 200 | 3.366 / 3.562 → 2.212 / 3.095 | 5.831 / 6.840 → 2.999 / 1.990 |
| 2,000 | 15.848 / 16.283 → 4.865 / 4.475 | 32.234 / 33.151 → 4.370 / 4.630 |

Large limits remain 7.924/8.142 ms for backup and 16.117/16.576 ms for GC.
The final medians satisfy all four. Every size permits authenticated API and
event-loop progress while GC is unfinished and specifically after SQLite's
snapshot while backup remains unfinished. At 2,000 assets, median backup
post-snapshot progress is 256 responses/2,650 turns; GC permits 383 responses/
806 turns. Original post-snapshot/GC progress was zero.

| Assets | Backup median total, before → after (ms) | GC median total, before → after (ms) |
| --- | --- | --- |
| 20 | 2.934 → 57.720 | 1.104 → 8.569 |
| 200 | 5.603 → 65.002 | 5.831 → 36.560 |
| 2,000 | 23.690 → 197.021 | 32.234 → 306.965 |

Responsiveness has an explicit throughput/startup cost. Large backup median
SQLite time is 5.711 ms and post-snapshot time 190.775 ms. This change does not
claim faster total completion or lower heap/RSS. The final large median sampled
backup API-isolate heap peak is 293,569,408 bytes and process RSS peak is
592,216,064 bytes; worker heaps are excluded from `heapUsed` but included in RSS.
These are samples in the full fixture/request process, not retained-memory or
per-worker guarantees. Process lifetime maxRSS remains labeled separately.

## Bounds and Correctness Evidence

- Reference discovery projects at most 64 source rows, yielding after 256 KiB
  or 4 ms, and spills distinct references/chat IDs into a scratch SQLite database
  with a 2 MiB cache. The large fixture scans 4,602 rows/1,391,666 projected bytes,
  with a largest row of 333 bytes and 1,000 distinct references. It yields 78–79
  times. No primary iterator or transaction spans a yield.
- Backup uses two native workers, one 16-descriptor batch each, no queued batches,
  and a reusable 64 KiB hash buffer each. Directory traversal retains at most
  64 entries at each of 32 levels. Snapshot reference membership and asset
  metadata remain paged. Every batch acknowledgement and worker exit precedes
  scratch cleanup, publication or maintenance lease release.
- GC admits one sweep. Grace discovery has four in-flight file-age reads;
  reclamation uses at most 16 candidates per synchronous transaction/turn and
  retains at most 1,024 deleted IDs/names plus complete counts. It checks write,
  external-connection, lineage, staging and upload-activity fences. Successful
  metadata commit and canonical unlink have no intervening await. Stale scans
  retain remaining candidates; failed commits preserve bytes.
- Exact focused tests pass: shared reference scanner 16, GC 19, GC scheduling 17,
  native backup workers 17, backup maintenance 22, backups 53, and final cost
  matrix 2. Existing local-backup/database, save/staging/import checks are listed
  in status at their execution anchors. Final aggregate remains pending until
  Phases 5–6 implementation finishes.
- Tests use real HTTP/SSE during suspended maintenance, controlled new references,
  deduplicated mtime-only uploads, completed staging intervals, pins, cancellation,
  shutdown, rollback, re-upload after a committed batch, restore fallback and
  real native worker errors/drain. Backup byte hashes match the captured snapshot;
  GC deletes exactly the old orphan half and preserves referenced/backup copies.

## Retained Costs and Recovery

A single existing oversized projected field, native legacy JSON parse/rescan,
or native filesystem operation can exceed a cooperative slice. The scanner
reports the largest row; new storage limits are not introduced. Worker native
copy cannot be interrupted mid-call, so cancellation/shutdown waits for it.
Scratch marks are disposable and cleaned or recovered at the next attempt.

Public backup listing and journaled restore staging/swap/recovery retain their
existing synchronous costs. Continuous accepted writes may stop GC conservatively;
quiescent later sweeps reclaim remaining candidates. No new public job protocol
or reference index requiring authoritative rebuilds is introduced. Current
ownership and rollback contracts live in
[assets and saves](../../../structure/assets-and-saves.md) and
[backend lifecycle](../../../structure/backend.md).

Revisit triggers remain attached to these owners:

- `repository.ts` owns synchronous public listing and journaled restore phases.
  If a reported listing/restore stall is reproduced, add its actual manifest/file
  dimensions to a separate latency probe before extending worker ownership;
  the accepted backup/GC timings do not establish bounds for those operations.
- `assetReferenceScan.ts` owns projected-row scanning. Revisit storage
  projection/chunking when a single reported row or legacy parse exceeds the
  four-millisecond cooperative target, or new supported reference-bearing data
  cannot be projected without a full scalar. The current measured largest row
  is 333 bytes; arbitrary existing values are not limited by that fixture.
- `backupCopyWorker.ts` and its pool own uncancellable native copy/hash calls.
  Revisit chunked copy when a reproduced cancellation/shutdown delay is dominated
  by one file; retain drain-before-cleanup/publication while changing it. The
  measured fixture uses 1 KiB assets and makes no single-large-file drain claim.
- `assetGc.ts` owns conservative freshness stops. If repeated scheduled sweeps
  remain stale or skipped and candidates grow across an otherwise quiescent
  interval, inspect their recorded status/counts and reference/activity fences
  before adding resumable progress. Never weaken reference protection to finish
  a sweep during accepted writes.
