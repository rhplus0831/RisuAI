# Maintenance Baseline and Scheduling Budgets

Production code: `491cc1820`; measured at `f1fa4753b` with the new probe.
[Raw environment and samples](maintenance-costs-before.json).
Source: `server/fastify/__tests__/maintenanceCosts.test.ts`.

Exact isolated invocation (two tests passed):

```sh
RISU_MAINTENANCE_COSTS=1 RISU_MAINTENANCE_COST_REPETITIONS=3 pnpm test -- server/fastify/__tests__/maintenanceCosts.test.ts
```

Node 24.19.0, Linux x64, AMD Ryzen 9 9950X with ten visible CPUs. The probe uses
one warmup per size and three measured repetitions in fresh temporary stores;
OS page cache is not flushed. Each file is one KiB with a real SHA-256 identity.
Half of assets are referenced, half are old orphans. Fixtures have 2/20/200
characters, two chats per character and ten inlay-bearing messages per chat,
plus one 896-byte compatibility save. Providers and real user data are absent.

The real SQLite backup is timed independently through a test-only wrapper.
Post-snapshot time includes copies/manifest. Recursive-copy call timing is a
separate diagnostic and must not be added to total duration. An authenticated
constant-size inlay-catalog GET and a setImmediate heartbeat run during work.
Heap/RSS are sampled at boundaries and heartbeats; process-lifetime maxRSS is
labeled separately and is not a per-operation peak. Fresh-directory fixture
setup and correctness verification are outside timing.

| Assets | Backup median total / max event-loop gap / max API response (ms) | GC median total / max event-loop gap / max API response (ms) |
| --- | --- | --- |
| 20 | 2.934 / 1.270 / 1.468 | 1.104 / 1.104 / 1.676 |
| 200 | 5.603 / 3.366 / 3.562 | 5.831 / 5.831 / 6.840 |
| 2,000 | 23.690 / 15.848 / 16.283 | 32.234 / 32.234 / 33.151 |

Backup permits request/heartbeat progress during SQLite's existing await, but
all nine cases record zero request responses and zero turns after the snapshot
while copying/manifest work is unfinished. GC records zero request responses
and zero turns during work at every size. Total duration alone therefore cannot
establish the required responsiveness improvement.

## Budgets set before Phase 4

- Large backup and GC must each permit at least one authenticated request and
  one event-loop turn while unfinished; backup must satisfy this specifically
  after SQLite snapshot completion. Add stream-progress verification in the
  Phase 4 behavior tests.
- At the large point, median maximum event-loop gap and maximum API response
  should fall to at most half the corresponding baseline: backup 7.924/8.142 ms,
  GC 16.117/16.576 ms. Keep raw samples and rerun matched measurements if noise
  prevents a valid comparison. These local comparison targets are not service
  latency promises; deterministic per-turn/batch bounds remain the stable gate.
- Bound each filesystem batch/queue and prevent overlapping backups or sweeps.
  Record the selected count before implementing each scheduler. Required SQLite
  snapshot/revalidation work remains measured separately.
- Small workloads must preserve byte/row correctness and receive the same
  bounded scheduling guarantees. Extra async completion overhead is reported
  separately from event-loop responsiveness rather than hidden in a total-time
  comparison.

Every captured SQLite asset metadata row has verified bytes with matching size
and SHA-256 in the backup; compatibility bytes match; GC removes exactly the
old orphan half and leaves referenced and backup copies intact. This static
fixture does not establish safety across awaits. Phase 4 must add deterministic
new-reference, staging, backup-pin, import/restore, mutable-save, cancellation,
and shutdown interleavings before changing the synchronous consistency boundary.
