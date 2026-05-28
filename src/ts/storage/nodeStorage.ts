import { language } from 'src/lang'
import { alertError, alertInput, waitAlert } from '../alert'
import { isFastifyServer } from '../platform'
import { activeWriterSessionHeader, handleActiveWriterStaleResponse } from '../server/activeWriterSession'
import { base64url, getKeypairStore, saveKeypairStore } from '../util'

const ROUTES = {
  write: '/api/v1/storage/write',
  read: '/api/v1/storage/read',
  list: '/api/v1/storage/list',
  remove: '/api/v1/storage/remove',
  crypto: '/api/v1/auth/crypto',
  status: '/api/v1/auth/status',
  setPassword: '/api/v1/auth/setup',
  login: '/api/v1/auth/login',
}

type AuthStatus = 'unset' | 'incorrect' | 'success'

async function fetchAuthStatus(assertion: string): Promise<AuthStatus> {
  const res = await fetch(ROUTES.status, {
    headers: { 'risu-auth': assertion },
  })
  if (res.status >= 200 && res.status < 300) {
    const body = (await res.json()) as { noPassword?: boolean; authorized?: boolean }
    if (body.noPassword) return 'unset'
    return body.authorized ? 'success' : 'incorrect'
  }
  return 'incorrect'
}

export class NodeStorage {
  authChecked = false
  JSONStringlifyAndbase64Url(obj: any) {
    return base64url(Buffer.from(JSON.stringify(obj), 'utf-8'))
  }

  async createAuth() {
    const keyPair = await this.getKeyPair()
    const date = Math.floor(Date.now() / 1000)

    const header = {
      alg: 'ES256',
      typ: 'JWT',
    }
    const payload = {
      iat: date,
      exp: date + 5 * 60, //5 minutes expiration
      pub: await crypto.subtle.exportKey('jwk', keyPair.publicKey),
    }
    const sig = await crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: 'SHA-256',
      },
      keyPair.privateKey,
      Buffer.from(
        this.JSONStringlifyAndbase64Url(header) + '.' + this.JSONStringlifyAndbase64Url(payload),
      ),
    )
    const sigString = base64url(new Uint8Array(sig))
    return (
      this.JSONStringlifyAndbase64Url(header) +
      '.' +
      this.JSONStringlifyAndbase64Url(payload) +
      '.' +
      sigString
    )
  }

  async getProxyAuth() {
    await this.checkAuth()
    const auth = await this.createAuth()
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('risuauth', auth)
    }
    return auth
  }

  async getKeyPair(): Promise<CryptoKeyPair> {
    const storedKey = await getKeypairStore('node')

    if (storedKey) {
      return storedKey
    }

    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      false,
      ['sign', 'verify'],
    )

    await saveKeypairStore('node', keyPair)

    return keyPair
  }

  async setItem(key: string, value: Uint8Array) {
    await this.checkAuth()
    const da = await fetch(ROUTES.write, {
      method: 'POST',
      body: value as any,
      headers: {
        'content-type': 'application/octet-stream',
        'file-path': Buffer.from(key, 'utf-8').toString('hex'),
        'risu-auth': await this.createAuth(),
        ...activeWriterSessionHeader(),
      },
    })
    if (da.status < 200 || da.status >= 300) {
      handleActiveWriterStaleResponse(da)
      throw 'setItem Error'
    }
    const data = await da.json()
    if (data.error) {
      throw data.error
    }
  }
  async getItem(key: string): Promise<Buffer> {
    await this.checkAuth()
    const da = await fetch(ROUTES.read, {
      method: 'GET',
      headers: {
        'file-path': Buffer.from(key, 'utf-8').toString('hex'),
        'risu-auth': await this.createAuth(),
      },
    })
    if (da.status < 200 || da.status >= 300) {
      throw 'getItem Error'
    }

    const data = Buffer.from(await da.arrayBuffer())
    if (data.length == 0) {
      return null
    }
    return data
  }
  async keys(): Promise<string[]> {
    await this.checkAuth()
    const da = await fetch(ROUTES.list, {
      method: 'GET',
      headers: {
        'risu-auth': await this.createAuth(),
      },
    })
    if (da.status < 200 || da.status >= 300) {
      throw 'listItem Error'
    }
    const data = await da.json()
    if (data.error) {
      throw data.error
    }
    return data.content
  }
  async removeItem(key: string | string[]) {
    await this.checkAuth()
    const hexKey = (k: string) => Buffer.from(k, 'utf-8').toString('hex')
    const filePath = Array.isArray(key) ? key.map(hexKey).join('$$') : hexKey(key)
    const da = await fetch(ROUTES.remove, {
      method: 'POST',
      headers: {
        'file-path': filePath,
        'risu-auth': await this.createAuth(),
        ...activeWriterSessionHeader(),
      },
    })
    if (da.status < 200 || da.status >= 300) {
      handleActiveWriterStaleResponse(da)
      throw 'removeItem Error'
    }
    const data = await da.json()
    if (data.error) {
      throw data.error
    }
  }

  private async checkAuth() {
    if (!this.authChecked) {
      const status = await fetchAuthStatus(await this.createAuth())

      if (status === 'unset') {
        const input = await digestPassword(await alertInput(language.setNodePassword))
        await fetch(ROUTES.setPassword, {
          method: 'POST',
          body: JSON.stringify({
            password: input,
          }),
          headers: {
            'content-type': 'application/json',
          },
        })
        return await this.createAuth()
      } else if (status === 'incorrect') {
        const keypair = await this.getKeyPair()
        const publicKey = await crypto.subtle.exportKey('jwk', keypair.publicKey)
        const input = await digestPassword(await alertInput(language.inputNodePassword))

        const s = await fetch(ROUTES.login, {
          method: 'POST',
          body: JSON.stringify({
            password: input,
            publicKey: publicKey,
          }),
          headers: {
            'content-type': 'application/json',
          },
        })
        if (s.status < 200 || s.status >= 300) {
          let message = `Login failed (${s.status})`
          try {
            const body = await s.json()
            if (body?.error) {
              message = body.error
            }
          } catch {}
          alertError(message)
          await waitAlert()
          throw message
        }
        this.authChecked = true
        return await this.createAuth()
      } else {
        this.authChecked = true
      }
    }
  }

  listItem = this.keys
}

const sharedNodeStorage = new NodeStorage()

export async function getNodeServerProxyAuth() {
  if (isFastifyServer && import.meta.env.VITE_FASTIFY_BROWSER_SMOKE === 'TRUE') {
    return ''
  }
  return await sharedNodeStorage.getProxyAuth()
}

async function digestPassword(message: string) {
  const response = await fetch(ROUTES.crypto, {
    body: JSON.stringify({
      data: message,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  if (response.status < 200 || response.status >= 300) {
    let message = `Password crypto failed (${response.status})`
    try {
      const body = await response.json()
      if (body?.error) {
        message = body.error
      }
    } catch {}
    throw message
  }
  const crypt = await response.text()

  return crypt
}
