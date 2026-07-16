<script lang="ts">
  import TextAreaInput from './TextAreaInput.svelte'

  interface Props {
    initialContext: string
    initialValue: string
    onInput?: (value: string) => void
    onchange?: () => void
  }

  let { initialContext, initialValue, onInput = () => {}, onchange = () => {} }: Props = $props()
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

<TextAreaInput bind:value {popupEditorContext} {onInput} {onchange} />
