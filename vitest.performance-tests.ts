// Performance contracts run outside ordinary frontend execution so concurrent
// work cannot invalidate their timing and clone-count thresholds.
export const performanceTestFiles = [
  'src/ts/__tests__/renderCostHarness.test.ts',
  'src/ts/__tests__/sendCloneCountProbe.test.ts',
] as const
