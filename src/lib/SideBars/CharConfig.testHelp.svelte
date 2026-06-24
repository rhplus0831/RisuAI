<script lang="ts">
  interface Props {
    key: string
  }

  let { key }: Props = $props()
</script>

<span data-testid="help-{key}"></span>
