<script lang="ts">
  interface Props {
    value?: string
    placeholder?: string
    ariaLabel?: string
    onInput?: () => void
    onchange?: () => void
  }

  let { value = $bindable(), placeholder = '', ariaLabel, onInput = () => {}, onchange = () => {} }: Props = $props()
</script>

<textarea bind:value {placeholder} aria-label={ariaLabel} oninput={onInput} {onchange}></textarea>
