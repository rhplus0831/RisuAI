import { writable } from 'svelte/store'

export const MobileGUIStack = writable(0)
export const MobileSearch = writable('')
export const MobileSideBar = writable(0)
export const SettingsMenuIndex = writable(-1)
export const selectedCharID = writable(-1)
