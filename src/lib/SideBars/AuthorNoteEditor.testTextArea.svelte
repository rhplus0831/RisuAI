<script lang="ts">
  interface Props {
    value: string
    placeholder?: string
    ariaLabel?: string
    onInput?: (value: string) => void
  }

  let { value = $bindable(), placeholder = '', ariaLabel = undefined, onInput = () => {} }: Props = $props()
</script>

<textarea
  data-testid="author-note-input"
  aria-label={ariaLabel}
  bind:value
  {placeholder}
  oninput={(event) => onInput(event.currentTarget.value)}></textarea>
