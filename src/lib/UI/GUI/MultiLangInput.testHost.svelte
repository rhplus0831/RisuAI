<script lang="ts">
  import MultiLangInput from './MultiLangInput.svelte'

  interface Props {
    initialValue: string
  }

  let { initialValue }: Props = $props()
  const readInitialValue = () => initialValue
  let value = $state(readInitialValue())

  export function switchValue(nextValue: string): void {
    value = nextValue
  }

  export function currentValue(): string {
    return value
  }
</script>

<MultiLangInput bind:value />
