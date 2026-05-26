import { BaseDirectory, readFile, readDir, writeFile } from '@tauri-apps/plugin-fs'
import { alertError, alertNormal, alertStore, alertWait, alertMd, alertConfirm } from '../alert'
import { LocalWriter, forageStorage, requiresFullEncoderReload } from '../globalApi.svelte'
import { isFastifyServer, isTauri } from 'src/ts/platform'
import { decodeRisuSave, encodeRisuSaveLegacy } from './risuSave'
import { getDatabase, setDatabaseLite } from './database.svelte'
import { relaunch } from '@tauri-apps/plugin-process'
import { sleep } from '../util'
import { language } from 'src/lang'
import { createServerBackup } from '../server/backups'
import {
  getColdStorageItem,
  listColdDataKeys,
  setColdStorageItem,
} from '../process/coldstorage.svelte'

export async function SaveLocalBackup() {
  if (isFastifyServer) {
    alertWait('Saving server backup...')
    const result = await createServerBackup({ label: 'Manual backup' })
    if (result.status === 'ok') {
      alertNormal('Server backup saved')
    } else if (result.status === 'error') {
      alertError(result.error)
    }
    return
  }

  alertWait('Saving local backup...')
  const writer = new LocalWriter()
  const r = await writer.init()
  if (!r) {
    alertError('Failed')
    return
  }

  const db = getDatabase()
  const assetMap = new Map<string, { charName: string; assetName: string }>()
  if (db.characters) {
    for (const char of db.characters) {
      if (!char) continue
      const charName = char.name ?? 'Unknown Character'

      if (char.image) assetMap.set(char.image, { charName: charName, assetName: 'Main Image' })

      if (char.emotionImages) {
        for (const em of char.emotionImages) {
          if (em && em[1]) assetMap.set(em[1], { charName: charName, assetName: em[0] })
        }
      }
      if (char.additionalAssets) {
        for (const em of char.additionalAssets) {
          if (em && em[1]) assetMap.set(em[1], { charName: charName, assetName: em[0] })
        }
      }
      if (char.vits) {
        const keys = Object.keys(char.vits.files)
        for (const key of keys) {
          const vit = char.vits.files[key]
          if (vit) assetMap.set(vit, { charName: charName, assetName: key })
        }
      }
      if (char.ccAssets) {
        for (const asset of char.ccAssets) {
          if (asset && asset.uri)
            assetMap.set(asset.uri, { charName: charName, assetName: asset.name })
        }
      }
    }
  }
  if (db.userIcon) {
    assetMap.set(db.userIcon, { charName: 'User Settings', assetName: 'User Icon' })
  }
  if (db.customBackground) {
    assetMap.set(db.customBackground, { charName: 'User Settings', assetName: 'Custom Background' })
  }
  const missingAssets: string[] = []

  if (isTauri) {
    const assets = await readDir('assets', { baseDir: BaseDirectory.AppData })
    let i = 0
    for (let asset of assets) {
      i += 1
      let message = `Saving local Backup... (${i} / ${assets.length})`
      if (missingAssets.length > 0) {
        const skippedItems = missingAssets
          .map((key) => {
            const assetInfo = assetMap.get(key)
            return assetInfo ? `'${assetInfo.assetName}' from ${assetInfo.charName}` : `'${key}'`
          })
          .join(', ')
        message += `\n(Skipping... ${skippedItems})`
      }
      alertWait(message)

      const key = asset.name
      if (!key || !key.endsWith('.png')) {
        continue
      }
      const data = await readFile('assets/' + asset.name, { baseDir: BaseDirectory.AppData })
      if (data) {
        await writer.writeBackup(key, data)
      } else {
        missingAssets.push(key)
      }
    }
  } else {
    const keys = await forageStorage.keys()

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      let message = `Saving local Backup... (${i + 1} / ${keys.length})`
      if (missingAssets.length > 0) {
        const skippedItems = missingAssets
          .map((key) => {
            const assetInfo = assetMap.get(key)
            return assetInfo ? `'${assetInfo.assetName}' from ${assetInfo.charName}` : `'${key}'`
          })
          .join(', ')
        message += `\n(Skipping... ${skippedItems})`
      }
      alertWait(message)

      if (!key || !key.endsWith('.png')) {
        continue
      }
      const data = (await forageStorage.getItem(key)) as unknown as Uint8Array

      if (data) {
        await writer.writeBackup(key, data)
      } else {
        missingAssets.push(key)
      }
    }
  }

  const coldKeys = await listColdDataKeys()
  for (let i = 0; i < coldKeys.length; i++) {
    const key = coldKeys[i]
    let message = `Saving local Backup Cold data... (${i + 1} / ${coldKeys.length})`
    alertWait(message)
    const data = await getColdStorageItem(key)
    if (data) {
      const encoded = new TextEncoder().encode(JSON.stringify(data))
      await writer.writeBackup(`coldstorage/${key}.json`, encoded)
    } else {
      missingAssets.push(`coldstorage/${key}.json`)
    }
  }

  const dbWithoutAccount = { ...db, account: undefined }
  const dbData = encodeRisuSaveLegacy(dbWithoutAccount, 'compression')

  alertWait(`Saving local Backup... (Saving database)`)

  await writer.writeBackup('database.risudat', dbData)
  await writer.close()

  if (missingAssets.length > 0) {
    let message = 'Backup Successful, but the following assets were missing and skipped:\n\n'
    for (const key of missingAssets) {
      const assetInfo = assetMap.get(key)
      if (assetInfo) {
        message += `* **${assetInfo.assetName}** (from *${assetInfo.charName}*)  \n  *File: ${key}*\n`
      } else {
        message += `* **Unknown Asset**  \n  *File: ${key}*\n`
      }
    }
    alertMd(message)
  } else {
    alertNormal('Success')
  }
}

/**
 * Saves a partial local backup with only critical assets.
 *
 * Differences from SaveLocalBackup:
 * - Only includes profile images for characters/groups (excludes emotion images, additional assets, VITS files, CC assets)
 * - Additionally includes: persona icons, folder images, bot preset images
 * - Processes only assets in assetMap (selective) instead of all .png files in assets folder
 * - Faster and more efficient for quick backups
 * - Ideal for backing up core visual identity without bulk data
 */
export async function SavePartialLocalBackup() {
  if (isFastifyServer) {
    alertError('Partial local backup is not supported in server-backed web mode yet')
    return
  }

  const firstConfirm = await alertConfirm(language.partialBackupFirstConfirm)

  if (!firstConfirm) {
    return
  }

  const secondConfirm = await alertConfirm(language.partialBackupSecondConfirm)

  if (!secondConfirm) {
    return
  }

  alertWait('Saving partial local backup...')
  const writer = new LocalWriter()
  const r = await writer.init()
  if (!r) {
    alertError('Failed')
    return
  }

  const db = getDatabase()
  const assetMap = new Map<string, { charName: string; assetName: string }>()

  if (db.characters) {
    for (const char of db.characters) {
      if (!char) continue
      const charName = char.name ?? 'Unknown Character'

      if (char.image) {
        assetMap.set(char.image, { charName: charName, assetName: 'Profile Image' })
      }
    }
  }

  if (db.userIcon) {
    assetMap.set(db.userIcon, { charName: 'User Settings', assetName: 'User Icon' })
  }

  if (db.personas) {
    for (const persona of db.personas) {
      if (persona && persona.icon) {
        assetMap.set(persona.icon, { charName: 'Persona', assetName: `${persona.name} Icon` })
      }
    }
  }

  if (db.customBackground) {
    assetMap.set(db.customBackground, { charName: 'User Settings', assetName: 'Custom Background' })
  }

  if (db.characterOrder) {
    for (const item of db.characterOrder) {
      if (typeof item !== 'string' && item.img) {
        assetMap.set(item.img, { charName: 'Folder', assetName: `${item.name} Folder Image` })
      }
      if (typeof item !== 'string' && item.imgFile) {
        assetMap.set(item.imgFile, {
          charName: 'Folder',
          assetName: `${item.name} Folder Image File`,
        })
      }
    }
  }

  if (db.botPresets) {
    for (const preset of db.botPresets) {
      if (preset && preset.image) {
        assetMap.set(preset.image, { charName: 'Preset', assetName: `${preset.name} Preset Image` })
      }
    }
  }

  const missingAssets: string[] = []

  if (isTauri) {
    const assets = await readDir('assets', { baseDir: BaseDirectory.AppData })
    let i = 0
    for (let asset of assets) {
      if (!asset.name) {
        continue
      }

      const keyWithPrefix = asset.name.startsWith('assets/') ? asset.name : `assets/${asset.name}`
      if (!keyWithPrefix.endsWith('.png')) {
        continue
      }

      if (!assetMap.has(keyWithPrefix)) {
        continue
      }

      i += 1
      let message = `Saving partial local backup... (${i} / ${assetMap.size})`
      if (missingAssets.length > 0) {
        const skippedItems = missingAssets
          .map((key) => {
            const assetInfo = assetMap.get(key)
            return assetInfo ? `'${assetInfo.assetName}' from ${assetInfo.charName}` : `'${key}'`
          })
          .join(', ')
        message += `\n(Skipping... ${skippedItems})`
      }
      alertWait(message)

      const data = await readFile(keyWithPrefix, { baseDir: BaseDirectory.AppData })
      if (data) {
        await writer.writeBackup(keyWithPrefix, data)
      } else {
        missingAssets.push(keyWithPrefix)
      }
    }
  } else {
    const assetKeys = Array.from(assetMap.keys())

    for (let i = 0; i < assetKeys.length; i++) {
      const key = assetKeys[i]
      let message = `Saving partial local backup... (${i + 1} / ${assetKeys.length})`
      if (missingAssets.length > 0) {
        const skippedItems = missingAssets
          .map((key) => {
            const assetInfo = assetMap.get(key)
            return assetInfo ? `'${assetInfo.assetName}' from ${assetInfo.charName}` : `'${key}'`
          })
          .join(', ')
        message += `\n(Skipping... ${skippedItems})`
      }
      alertWait(message)

      if (!key || !key.endsWith('.png')) {
        continue
      }

      const data = (await forageStorage.getItem(key)) as unknown as Uint8Array

      if (data) {
        await writer.writeBackup(key, data)
      } else {
        missingAssets.push(key)
      }
    }
  }

  const dbWithoutAccount = { ...db, account: undefined }
  const dbData = encodeRisuSaveLegacy(dbWithoutAccount, 'compression')

  alertWait(`Saving partial local backup... (Saving database)`)

  await writer.writeBackup('database.risudat', dbData)
  await writer.close()

  if (missingAssets.length > 0) {
    let message =
      'Partial backup successful, but the following profile images were missing and skipped:\n\n'
    for (const key of missingAssets) {
      const assetInfo = assetMap.get(key)
      if (assetInfo) {
        message += `* **${assetInfo.assetName}** (from *${assetInfo.charName}*)  \n  *File: ${key}*\n`
      } else {
        message += `* **Unknown Asset**  \n  *File: ${key}*\n`
      }
    }
    alertMd(message)
  } else {
    alertNormal('Success')
  }
}

export function LoadLocalBackup() {
  if (isFastifyServer) {
    alertError('Local backup file restore is not supported in server-backed web mode yet')
    return
  }

  try {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.bin'
    input.onchange = async () => {
      if (!input.files || input.files.length === 0) {
        input.remove()
        return
      }
      const file = input.files[0]
      input.remove()

      const reader = file.stream().getReader()
      let bytesRead = 0
      let remainingBuffer = new Uint8Array()

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        bytesRead += value.length
        const progress = ((bytesRead / file.size) * 100).toFixed(2)
        alertWait(`Loading local Backup... (${progress}%)`)

        const newBuffer = new Uint8Array(remainingBuffer.length + value.length)
        newBuffer.set(remainingBuffer)
        newBuffer.set(value, remainingBuffer.length)
        remainingBuffer = newBuffer

        let offset = 0
        while (offset + 4 <= remainingBuffer.length) {
          const nameLength = new Uint32Array(remainingBuffer.slice(offset, offset + 4).buffer)[0]

          if (offset + 4 + nameLength > remainingBuffer.length) {
            break
          }
          const nameBuffer = remainingBuffer.slice(offset + 4, offset + 4 + nameLength)
          const name = new TextDecoder().decode(nameBuffer)

          if (offset + 4 + nameLength + 4 > remainingBuffer.length) {
            break
          }
          const dataLength = new Uint32Array(
            remainingBuffer.slice(offset + 4 + nameLength, offset + 4 + nameLength + 4).buffer,
          )[0]

          if (offset + 4 + nameLength + 4 + dataLength > remainingBuffer.length) {
            break
          }
          const data = remainingBuffer.slice(
            offset + 4 + nameLength + 4,
            offset + 4 + nameLength + 4 + dataLength,
          )

          if (name === 'database.risudat') {
            const db = new Uint8Array(data)
            const dbData = await decodeRisuSave(db)
            setDatabaseLite(dbData)
            requiresFullEncoderReload.state = true
            if (isTauri) {
              await writeFile('database/database.bin', db, { baseDir: BaseDirectory.AppData })
              await relaunch()
              alertStore.set({
                type: 'wait',
                msg: 'Success, Refreshing your app.',
              })
            } else {
              await forageStorage.setItem('database/database.bin', db)
              location.search = ''
              alertStore.set({
                type: 'wait',
                msg: 'Success, Refreshing your app.',
              })
            }
          } else if (name.startsWith('coldstorage/')) {
            const key = name.replace('coldstorage/', '').replace('.json', '')
            const text = new TextDecoder().decode(data)
            try {
              const jsonData = JSON.parse(text)
              await setColdStorageItem(key, jsonData)
            } catch (e) {
              console.error(`Failed to parse cold storage item ${key}:`, e)
            }
          } else {
            if (isTauri) {
              await writeFile(`assets/` + name, data, { baseDir: BaseDirectory.AppData })
            } else {
              await forageStorage.setItem('assets/' + name, data)
            }
          }
          await sleep(10)

          offset += 4 + nameLength + 4 + dataLength
        }
        remainingBuffer = remainingBuffer.slice(offset)
      }

      alertNormal('Success')
    }

    input.click()
  } catch (error) {
    console.error(error)
    alertError('Failed, Is file corrupted?')
  }
}
