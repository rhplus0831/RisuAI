<script lang="ts">
  import { normalizePluginIcon, sanitizePluginIconHtml } from 'src/ts/plugins/pluginIconSafety'

  let {
    ico,
    className,
  }: {
    ico: {
      iconType: 'html' | 'img' | 'none'
      icon: string
    }
    className?: string
  } = $props()

  const safeImageIcon = (url: string) => {
    try {
      return normalizePluginIcon(url, 'img')
    } catch (error) {
      console.warn(error)
      return ''
    }
  }
</script>

<div
  class={{
    'w-5 h-5': !className,
    [className]: className,
  }}>
  {#if ico.iconType === 'html'}
    {@html sanitizePluginIconHtml(ico.icon)}
  {:else if ico.iconType === 'img'}
    <img src={safeImageIcon(ico.icon)} alt="icon" />
  {/if}
</div>
