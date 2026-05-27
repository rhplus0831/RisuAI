import './ts/polyfill'
import 'core-js/actual'
import './ts/storage/database.svelte'
import App from './App.svelte'
import { loadData } from './ts/bootstrap'
import { initHotkey } from './ts/hotkey'
import { mount } from 'svelte'
import { installFastifyBrowserSmokeHook } from './ts/server/browserSmoke'

let app = mount(App, {
  target: document.getElementById('app'),
})
if (import.meta.env.VITE_FASTIFY_BROWSER_SMOKE === 'TRUE') {
  installFastifyBrowserSmokeHook()
}
loadData()
initHotkey()
document.getElementById('preloading').remove()

export default app
