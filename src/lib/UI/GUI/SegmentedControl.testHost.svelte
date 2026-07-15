<script lang="ts">
  import SegmentedControl from './SegmentedControl.svelte'

  let value = $state<string | number>('first')
  let size = $state<'sm' | 'md' | 'lg'>('md')
  let options = $state([
    { value: 'first', label: 'First' },
    { value: 'second', label: 'Second' },
  ])

  export function changeActiveLabel(label: string): void {
    options = options.map((option) => (option.value === value ? { ...option, label } : option))
  }

  export function changeSize(nextSize: 'sm' | 'md' | 'lg'): void {
    size = nextSize
  }
</script>

<SegmentedControl bind:value {options} {size} />
