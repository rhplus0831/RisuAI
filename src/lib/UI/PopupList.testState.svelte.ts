import { writable } from 'svelte/store'

export const popupStore = $state({
  children: null as import('svelte').Snippet | null,
  mouseX: 0,
  mouseY: 0,
  openId: 0,
})

export const SizeStore = writable({ w: 1024, h: 768 })
