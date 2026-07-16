<script lang="ts">
  interface Props {
    value: string
    placeholder?: string
    ariaLabel?: string
    popupEditorContext?: unknown
    onInput?: (value: string) => void
  }

  let {
    value = $bindable(),
    placeholder = '',
    ariaLabel = undefined,
    popupEditorContext = undefined,
    onInput = () => {},
  }: Props = $props()
</script>

<textarea
  data-testid="author-note-input"
  data-popup-editor-context={typeof popupEditorContext === 'string' ? popupEditorContext : ''}
  aria-label={ariaLabel}
  bind:value
  {placeholder}
  oninput={(event) => onInput(event.currentTarget.value)}></textarea>
