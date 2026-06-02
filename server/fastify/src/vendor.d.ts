declare var safeStructuredClone: <T>(data: T) => T

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

declare module 'msgpackr/index-no-eval' {
  export { Unpackr, Packr } from 'msgpackr'
}

declare module 'ws' {
  import type { EventEmitter } from 'node:events'
  export class WebSocket extends EventEmitter {
    constructor(address: string | URL, protocols?: string | string[], options?: object)
    close(code?: number, data?: string | Buffer): void
    send(data: string | Buffer | ArrayBuffer | SharedArrayBuffer, cb?: (err?: Error) => void): void
    send(
      data: string | Buffer | ArrayBuffer | SharedArrayBuffer,
      options: { compress?: boolean; binary?: boolean; fin?: boolean; mask?: boolean },
      cb?: (err?: Error) => void,
    ): void
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this
    on(event: 'error', listener: (err: Error) => void): this
    on(event: 'message', listener: (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => void): this
    on(event: 'open', listener: () => void): this
    on(event: string, listener: (...args: unknown[]) => void): this
    readonly bufferedAmount: number
    readonly readyState: number
    readonly CONNECTING: 0
    readonly OPEN: 1
    readonly CLOSING: 2
    readonly CLOSED: 3
  }
  export class WebSocketServer extends EventEmitter {
    constructor(options?: object)
    close(cb?: (err?: Error) => void): void
    handleUpgrade(
      request: import('node:http').IncomingMessage,
      socket: import('node:stream').Duplex,
      head: Buffer,
      callback: (client: WebSocket, request: import('node:http').IncomingMessage) => void,
    ): void
    on(event: 'connection', listener: (socket: WebSocket, request: import('node:http').IncomingMessage) => void): this
    on(event: 'error', listener: (err: Error) => void): this
    on(event: string, listener: (...args: unknown[]) => void): this
  }
}
