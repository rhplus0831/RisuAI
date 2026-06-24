<script lang="ts">
  interface Props {
    value?: string
    onInput?: () => void
  }

  let { value = $bindable(), onInput = () => {} }: Props = $props()
</script>

<textarea data-testid="multilang-input" bind:value oninput={onInput}></textarea>
