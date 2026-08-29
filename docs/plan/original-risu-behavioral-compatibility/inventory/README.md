# Compatibility Inventory

[`compatibility-surfaces.json`](compatibility-surfaces.json) is the canonical
machine-readable inventory for this workstream. Validate it against
[`inventory.schema.json`](inventory.schema.json).

Phase 0 owns schema ratification and initial population. Later phases may add or
update rows only when they also update the row's evidence, verification commit,
and residual owner.

## Row Rules

- Use stable IDs in the form `ORC-SURFACE-<number>`.
- Assign exactly one primary category (`A` through `L`) and any number of seam
  tags.
- Keep `sourceObligation` separate from `verification.state`. In particular,
  `synced-upstream` means the upstream change was dispositioned; it does not mean
  the current Fastify behavior has been verified.
- Name exact baseline, upstream, browser, server, persistence, and test owners
  when applicable. Use an empty array only when the layer genuinely does not
  participate, and record that reason in `notes`.
- Record all observable fields that a comparison must preserve. Normalization
  may remove only documented nondeterministic noise.
- A completed row has reproducible evidence, a Fastify verification commit, and
  either compatible behavior, a signed decision, or an explicit unsupported
  contract.
- Never delete a retired row. Mark it `retired`, preserve its history, and point
  to the replacement or removal decision.

## Lifecycle

1. `candidate`: identified but not yet traced on both sides.
2. `mapped`: ownership and variants are complete enough to design evidence.
3. `verified`: runtime or structural evidence satisfies the compatibility
   contract.
4. `finding`: a canonical incompatibility is linked.
5. `decision-required`: parity depends on maintainer authority.
6. `retired`: the shared surface was removed or superseded with a recorded
   decision.

Inventory coverage is measured by classified rows and closed-world checks, not
by raw row count.
