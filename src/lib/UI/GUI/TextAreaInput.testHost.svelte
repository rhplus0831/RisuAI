<script lang="ts">
  import TextAreaInput from './TextAreaInput.svelte'

  interface Props {
    initialContext: string
    initialValue: string
    highlight?: boolean
    popupEditor?: boolean | 'auto'
    onInput?: (value: string) => void
    onchange?: () => void
    onAncestorKeydown?: (event: KeyboardEvent) => void
  }

  let {
    initialContext,
    initialValue,
    highlight = false,
    popupEditor = 'auto',
    onInput = () => {},
    onchange = () => {},
    onAncestorKeydown = () => {},
  }: Props = $props()
  const readInitialContext = () => initialContext
  const readInitialValue = () => initialValue
  let popupEditorContext = $state(readInitialContext())
  let value = $state(readInitialValue())

  export function replaceTarget(context: string, nextValue: string): void {
    popupEditorContext = context
    value = nextValue
  }

  export function getValue(): string {
    return value
  }
</script>

<div role="dialog" aria-label="Test ancestor" tabindex="-1" onkeydown={onAncestorKeydown}>
  <TextAreaInput bind:value {popupEditorContext} {highlight} {popupEditor} {onInput} {onchange} />
</div>
