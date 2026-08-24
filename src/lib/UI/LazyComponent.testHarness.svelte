<script lang="ts">
  import type { LazyComponentLoader } from './LazyComponent.svelte'
  import LazyComponent from './LazyComponent.svelte'

  interface Props {
    loaders: LazyComponentLoader[]
    testId?: string
  }

  let { loaders, testId = 'lazy-harness' }: Props = $props()
  let selected = $state(0)

  export function selectLoader(index: number): void {
    selected = index
  }
</script>

<LazyComponent loader={loaders[selected]} {testId} />
