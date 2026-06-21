# UI Audit Gates

This directory contains DOM-level audit acceptance probes. They are intentionally
outside the default frontend lane and run through the explicit gate scripts.

Run them with:

```sh
pnpm test:gates:audit
```

They are also included in:

```sh
pnpm test:gates
pnpm test:frontend:all
pnpm test:all
```

Keep ordinary component regressions next to their components. Use this directory
only for audit acceptance probes or other UI checks that should not make the
default frontend lane heavier.
