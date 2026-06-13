import { FastifyStorage } from './fastifyStorage'

export class AutoStorage {
  realStorage: FastifyStorage

  async setItem(key: string, value: Uint8Array): Promise<string | null> {
    await this.Init()
    await this.realStorage.setItem(key, value)
    return null
  }
  async getItem(key: string): Promise<Buffer> {
    await this.Init()
    return await this.realStorage.getItem(key)
  }
  async keys(): Promise<string[]> {
    await this.Init()
    return await this.realStorage.keys()
  }
  async hasItem(key: string): Promise<boolean> {
    await this.Init()
    return await this.realStorage.hasItem(key)
  }
  async removeItem(key: string | string[]) {
    await this.Init()
    return await this.realStorage.removeItem(key)
  }

  async Init() {
    if (!this.realStorage) {
      console.log('using fastify storage')
      this.realStorage = new FastifyStorage()
    }
  }

  listItem = this.keys
}
