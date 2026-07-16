<script lang="ts">
  interface Props {
    endGrid?: () => void
  }

  let { endGrid = () => {} }: Props = $props()
</script>

<button data-testid="grid-close" onclick={endGrid}>Close grid</button>
