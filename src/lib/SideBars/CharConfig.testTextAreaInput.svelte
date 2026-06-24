<script lang="ts">
  interface Props {
    value?: string
    placeholder?: string
    onInput?: () => void
    onchange?: () => void
  }

  let { value = $bindable(), placeholder = '', onInput = () => {}, onchange = () => {} }: Props = $props()
</script>

<textarea bind:value {placeholder} oninput={onInput} {onchange}></textarea>
