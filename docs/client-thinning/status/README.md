# Client Thinning Status Shards

Date: 2026-05-28

Open only the shard for the behavior being changed.

| Read when changing...                                                                  | Open                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Overall status, phase language, and main entry points                                  | [`overview.md`](overview.md)                                 |
| Batch selection and near-term priority                                                 | [`next-steps.md`](next-steps.md)                             |
| Bootstrap, projection write guard, event refresh, and storage ownership                | [`server-projection.md`](server-projection.md)               |
| Audit rules, fixture tests, and structural invariant work                              | [`audit.md`](audit.md)                                       |
| Command routes, command helpers, active writer, and revision behavior                  | [`command-boundaries.md`](command-boundaries.md)             |
| Assets, import/export, bundle, and backup/restore fidelity                             | [`assets-imports-backups.md`](assets-imports-backups.md)     |
| sendChat prompt assembly, generation persistence, and post-generation browser branches | [`sendchat-thinning.md`](sendchat-thinning.md)               |
| Browser-owned, unsupported, no-port, and deferred behavior                             | [`client-owned-unsupported.md`](client-owned-unsupported.md) |
