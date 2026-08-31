# Phase 0: Compatibility Inventory And Retention Policy

Status: complete at `cd04b0e11f2c8629e988af1ef6c99a2646a746f1`.

Depends on: Workstream 1 Phase 0 package/dependency convention release.

## Objective

Inventory compatibility fields, tables, routes, commands, adapters, fallback
reads, repairs, and interchange surfaces; give each exactly one disposition.

## Required Work

- Classify every surface as canonical, migrate, import-only, export-only,
  explicit compatibility, quarantine, or remove.
- Lock current/target precedence and missing, null, malformed, downgrade,
  failure, interruption, and damaged-database behavior.
- Name historical fixtures and exact provenance for model, prompt, translator,
  and candidate smaller domains.
- Record old readers/exporters, rollback requirements, and per-resource
  Workstream 3 holds/releases.
- Add a closed-world inventory gate so new compatibility surfaces cannot appear
  silently.

## Exit Criteria

- Every in-scope surface has one disposition and owner.
- Required decisions and fixtures exist or explicitly block the owning phase.
- No resource-family runtime work is authorized by an ambiguous inventory row.

## Validation

Inventory/schema tests, fixture existence/provenance checks, focused structural
gates, affected tests, formatting, and diff checks.

Prepared slice: [Compatibility surface inventory and disposition matrix](slices/phase-0-compatibility-inventory-and-retention-policy/compatibility-surface-inventory.md).

## Completion Evidence

[`compatibility-baseline.json`](../compatibility-baseline.json) classifies 19
surfaces with 38 live probes: 4 model-configuration, 5 prompt-template, 4
translator, 3 repair, and 3 interchange rows. The dispositions are 4 canonical,
9 migrate, 3 import-only, 2 explicit-compatibility, and 1 remove. Every row names
precedence, missing/malformed/damaged behavior, a locally reproducible fixture
and provenance, rollback proof, and a Workstream 3 hold or release rule.
