<script lang="ts">
  interface Props {
    value: string
    placeholder?: string
  }

  let { value = $bindable(), placeholder = '' }: Props = $props()
</script>

<textarea data-testid="author-note-input" bind:value {placeholder}></textarea>
