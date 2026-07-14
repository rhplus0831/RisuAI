# Phase 2: Audit Reproducibility

Date: 2026-05-29

Status: DONE.

Every client-thinning audit rule has a committed pre-fix fixture (plus a bypass
fixture where a rule has a narrow allowed shape) and a test that proves the rule
exits non-zero on that fixture. Phase 2 closed with all 21 checks reproducible;
the suite has since grown to 58 tests across 23 checks after the phase-5
audit-hardening and group-chat-removal batches.

Historical residual gap: several rules were string/regex matchers and four
(`A4R2`, `A4R7`, the fanout `.svelte` path, `EC2`) were empirically defeated by
sincere refactors. That phase-5 hardening is now done; the remaining shallow rules
only become work after a new demonstrated defeat. See
[`../status/audit.md`](../status/audit.md#verification-coverage) and
[`../status/audit.md`](../status/audit.md).
