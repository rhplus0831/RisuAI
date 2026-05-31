<script lang="ts">
  import { getAllContexts, mount, onDestroy, onMount, unmount } from 'svelte'
  import PortalConsumer from './PortalConsumer.svelte'

  interface Props {
    target?: HTMLElement
    children: any
    root?: HTMLElement
    idx?: number
  }

  let { target: target = document.body, children, root, idx }: Props = $props()
  let sentinel: HTMLSpanElement = $state(null)
  const context = getAllContexts()

  let instance
  let seen = $state(false)

  onMount(() => {
    if (!sentinel) {
      seen = true
      return
    }

    const observer = new IntersectionObserver(
      (v) => {
        if (v[0].intersectionRatio > 0.5) {
          seen = true
          observer.disconnect()
        }
      },
      {
        threshold: 0.5,
        root: root,
      },
    )

    observer.observe(sentinel)

    return () => {
      observer.disconnect()
    }
  })

  $effect(() => {
    if (seen && !instance) {
      try {
        instance = mount(PortalConsumer, { target, props: { children }, context })
      } catch (error) {}
    }
  })

  onDestroy(() => {
    if (instance) {
      unmount(instance)
    }
  })
</script>

<span bind:this={sentinel} class="lazy-portal-sentinel" data-lazy-portal-index={idx}></span>

<style>
  .lazy-portal-sentinel {
    display: block;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
</style>
