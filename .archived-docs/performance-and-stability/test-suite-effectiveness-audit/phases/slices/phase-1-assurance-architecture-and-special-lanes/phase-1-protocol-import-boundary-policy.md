# Phase 1 Remediation: Protocol Import-Boundary Policy

Date: 2026-08-29

Status: Complete.

## Scope And Contract

This prerequisite remediation owns
`packages/protocol/src/importBoundary.test.ts` and the browser-safe
`packages/protocol/src` runtime/export boundary. A Node-only dependency, a
relative package escape, or an unreviewed bare package must fail before it can
enter the shared browser/server protocol runtime.

## Evidence And Decision

The original single case inspected only top-level files and used a regex for
static import/export statements. Counterexamples showed credible nested,
dynamic-import, and `require` shapes outside its oracle. Type checking and
package exports do not enforce that dependency policy.

Decision: **Keep**, after strengthening. Recursive discovery now covers nested
runtime TypeScript files. TypeScript syntax traversal records static imports and
exports, dynamic imports, CommonJS `require`, and import-equals declarations.
Relative targets are resolved from the importing file and must remain inside
the source root. The fixture also proves import-looking string content does not
create a false violation.

No production file, helper, or fixture owner changed. This closes
`TSA-P00-001`; rollback is the test-only commit.

## Delta And Validation

- Test files: unchanged at 699.
- Cases: +1 counterexample; live total 9,976.
- Disposition: `Strengthen` to `Keep`; Phase 1 has one completed owner.

The focused 2/2 cases, `pnpm check:protocol`, and checked inventories passed.
`pnpm test:affected` then passed 6,640 ordinary frontend cases, all 6 isolated
performance cases, and 3,295 server cases plus the one intentional direct-only
skip. The aggregate remains reserved for the runner/config phase closeout
because production behavior and runtime configuration did not change.
