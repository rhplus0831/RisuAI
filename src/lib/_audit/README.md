# UI Audit Gates

This directory contains DOM-level audit acceptance probes. They run in the
default frontend lane so they share its Vitest startup and transform work.

Run them with:

```sh
pnpm test:gates:audit
```

They are also included in:

```sh
pnpm test:gates
pnpm test:frontend
pnpm test:frontend:all
pnpm test:all
```

Keep ordinary component regressions next to their components. Use this directory
only for cross-cutting audit acceptance probes that benefit from a dedicated
location.
