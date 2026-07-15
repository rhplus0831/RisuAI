<script lang="ts">
  interface Props {
    value: string
    placeholder?: string
    ariaLabel?: string
  }

  let { value = $bindable(), placeholder = '', ariaLabel = undefined }: Props = $props()
</script>

<textarea data-testid="author-note-input" aria-label={ariaLabel} bind:value {placeholder}></textarea>
