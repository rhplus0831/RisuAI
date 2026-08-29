export interface Phase9CbsCompatibilityFixture {
  name: string
  input: string
  expected: string
}

/**
 * State-independent legacy CBS fixtures shared by the browser adapter and the
 * Fastify adapter. Keep host/database-dependent callbacks in their owning
 * suites; this corpus locks grammar, matcher normalization, nesting, ordering,
 * missing callback fallback, and legacy loop substitution at both consumers.
 */
export const PHASE9_CBS_COMPATIBILITY_CORPUS: readonly Phase9CbsCompatibilityFixture[] = [
  {
    name: 'normalizes legacy matcher aliases and separators',
    input: '{{NOT_EQUAL::a::b}}|{{greater equal::2::2}}|{{Array_Element::["a","b"]::1}}',
    expected: '1|1|b',
  },
  {
    name: 'retains right-to-left #when evaluation through a nested block',
    input: '{{#if 1}}{{#when::1::or::0::and::0}}kept{{:else}}dropped{{/when}}{{/if}}',
    expected: 'kept',
  },
  {
    name: 'expands legacy each slots in source order',
    input: 'A{{#each [1, 2] as n}}({{slot::n}}){{/}}Z',
    expected: 'A(1)(2)Z',
  },
  {
    name: 'preserves an unknown matcher literally',
    input: 'before {{phase9_unknown::x}} after',
    expected: 'before {{phase9_unknown::x}} after',
  },
]
