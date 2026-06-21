# Client Thinning Audit Fixtures

These files are source fixtures for `util/client-thinning-audit.ts` and its
Vitest regression test. They are intentionally many small cases rather than app
runtime source.

Run the source audit with:

```sh
pnpm client-thinning:audit
```

Run the Vitest regression coverage for the audit with:

```sh
pnpm test:gates
```

Each subdirectory represents an audit rule or exemption shape. Keep new fixtures
minimal and name them for the rule behavior they prove.
