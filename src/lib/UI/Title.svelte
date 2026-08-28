<script lang="ts">
  import { onDestroy } from 'svelte'
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import { openURL } from 'src/ts/globalApi.svelte'

  let specialDay = $state('')
  const today = new Date()
  if (today.getMonth() === 11 && today.getDate() >= 19 && today.getDate() <= 25) {
    specialDay = 'christmas'
  }
  if (today.getMonth() === 0 && today.getDate() < 4) {
    specialDay = 'newYear'
  }
  if (today.getMonth() === 3 && today.getDate() === 1) {
    specialDay = 'aprilFool'
  }
  if (today.getMonth() === 3 && today.getDate() === 13) {
    specialDay = 'anniversary'
  }
  if (today.getMonth() === 9 && today.getDate() === 31) {
    specialDay = 'halloween'
  }
  if (today.getMonth() === 8 && today.getDate() === 16) {
    if (getDatabase().language === 'ko') {
      specialDay = 'chuseok'
    } else if (getDatabase().language === 'zh-Hant' || getDatabase().language === 'zh') {
      specialDay = 'midAutumn'
    }
  }
  let iconAnimation = $state(0)
  let clicks = $state(0)
  let score = $state(0)
  let time = $state(20)
  let miniGameStart = $state(false)
  let miniGameTimer: ReturnType<typeof setInterval> | undefined

  function clearMiniGameTimer() {
    if (miniGameTimer === undefined) return
    clearInterval(miniGameTimer)
    miniGameTimer = undefined
  }

  onDestroy(clearMiniGameTimer)

  function getNumberPostfix(num: number): string {
    const lastDigit = num % 10
    const lastTwoDigits = num % 100

    if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
      return 'th'
    }

    switch (lastDigit) {
      case 1:
        return 'st'
      case 2:
        return 'nd'
      case 3:
        return 'rd'
      default:
        return 'th'
    }
  }
</script>

<h2 class="text-4xl text-textcolor mb-0 mt-6 font-black relative" class:text-bordered={specialDay === 'newYear'}>
  {#if specialDay === 'midAutumn'}
    <span class="text-amber-400">🐉Risuai🐉</span>
  {:else if specialDay === 'chuseok'}
    <div class="flex">
      <span class="text-blue-500">R</span>
      <span class="text-red-500">i</span>
      <span class="text-yellow-500">s</span>
      <span class="text-white">u</span>
      <span class="text-black">A</span>
      <span class="text-blue-500">I</span>
    </div>
  {:else}
    Risuai
  {/if}
  {#if specialDay === 'christmas'}
    {#if clicks < 5}
      <button
        type="button"
        class="absolute logo-top border-0 bg-transparent p-0"
        style:top={(-20 + iconAnimation).toFixed(0) + 'px'}
        style:right={'-30px'}
        onclick={async () => {
          iconAnimation = Math.random() * 300
          clicks++
          if (clicks === 5) {
            iconAnimation = 0
          }
        }}>
        <img src="./santa.png" alt="santa" />
      </button>
    {/if}
  {/if}
  {#if specialDay === 'anniversary'}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    {#if clicks < 5}
      <img
        src="./birthday.png"
        alt="birthday"
        class="absolute logo-top"
        style:top={(-28 + iconAnimation).toFixed(0) + 'px'}
        style:right={'-30px'} />
    {/if}
  {/if}
  {#if specialDay === 'newYear'}
    <img src="./sun.webp" alt="sun" class="absolute -z-10" style:top={'-50px'} style:right={'0px'} />
  {/if}
</h2>

{#if specialDay === 'anniversary'}
  <h1>
    <button
      type="button"
      class="text-2xl font-extralight italic text-amber-400 hover:text-amber-600 cursor-pointer transition"
      onclick={() => {
        openURL('https://risuai.net')
      }}
      >Happy {new Date().getFullYear() - 2023}{getNumberPostfix(new Date().getFullYear() - 2023)} Anniversary!</button>
  </h1>
{/if}
{#if clicks >= 5}
  <div class="bg-black w-full p-3 mt-4 mb-4 rounded-md max-w-2xl" id="minigame-div">
    <span class="font-semibold text-lg">Score: {score}</span><br />
    <span class="font-semibold text-lg">Time: {time.toFixed(0)}</span>
    <button
      type="button"
      style:margin-left={iconAnimation + 'px'}
      class="border-0 bg-transparent p-0"
      onclick={async () => {
        const miniGameDiv = document.getElementById('minigame-div')
        const max = miniGameDiv.clientWidth - 70
        iconAnimation = Math.random() * max
        if (!miniGameStart) {
          if (time === 0) {
            time = 20
            iconAnimation = 0
            return
          }
          time = 20
          score = 1
          miniGameStart = true
          miniGameTimer = setInterval(() => {
            time -= 1
            if (time <= 0) {
              miniGameStart = false
              clearMiniGameTimer()
            }
          }, 700)
        } else {
          score++
        }
      }}>
      <img src="./santa.png" alt="santa" class:grayscale={!miniGameStart} />
    </button>
  </div>
{/if}
