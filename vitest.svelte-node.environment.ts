import { builtinEnvironments } from 'vitest/runtime'

// Svelte client runes such as $effect need Vite's client transform, but these
// tests should still execute with Node globals and without a DOM implementation.
export default {
  ...builtinEnvironments.node,
  name: 'svelte-node',
  viteEnvironment: 'client',
} as const
