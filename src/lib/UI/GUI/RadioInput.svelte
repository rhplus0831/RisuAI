<script lang="ts">
  interface Props {
    checked?: boolean
    group: string
    label: string
    onChange?: () => any
  }

  let { checked = false, group, label, onChange = () => {} }: Props = $props()
</script>

<label class="flex cursor-pointer items-center gap-2 text-textcolor">
  <input
    class="peer sr-only"
    type="radio"
    name={group}
    {checked}
    onchange={() => {
      onChange()
    }} />
  <span
    class="flex h-5 w-5 min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-darkborderc bg-darkbutton transition-colors duration-200 after:h-2 after:w-2 after:rounded-full after:bg-white after:opacity-0 after:content-[''] peer-checked:bg-darkborderc peer-checked:after:opacity-100 peer-focus-visible:ring-2 peer-focus-visible:ring-borderc peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bgcolor"
    aria-hidden="true">
  </span>
  <span>{label}</span>
</label>
