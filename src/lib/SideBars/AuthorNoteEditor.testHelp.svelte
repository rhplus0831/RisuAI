<script lang="ts">
  interface Props {
    key: string
  }

  let { key: helpKey }: Props = $props()
</script>

<span data-testid="author-note-help">{helpKey}</span>
