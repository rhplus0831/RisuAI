<script lang="ts">
  import { getAllContexts, mount, onDestroy, onMount, unmount } from 'svelte'
  import PortalConsumer from './PortalConsumer.svelte'

  interface Props {
    target?: HTMLElement
    children: any
  }

  let { target: target = document.body, children }: Props = $props()

  const context = getAllContexts()

  let instance

  onMount(() => {
    instance = mount(PortalConsumer, { target, props: { children }, context })
  })

  onDestroy(() => {
    if (instance) {
      unmount(instance)
    }
  })
</script>
