/**
 * How sync servers talk to each other. Every server that has a document open
 * subscribes to that document's channel and publishes every edit and presence
 * change it receives from its own clients, so people connected to different
 * servers still see each other live.
 */
export interface Bus {
  publish(channel: string, data: Uint8Array): void
  /** Returns an unsubscribe function. */
  subscribe(channel: string, handler: (data: Uint8Array) => void): () => void
  close?(): Promise<void>
}

export const docChannel = (docName: string) => `mm:doc:${docName}`

/** In-process bus for tests: several servers in one process share one of these. */
export class MemoryBus implements Bus {
  private handlers = new Map<string, Set<(d: Uint8Array) => void>>()
  publish(channel: string, data: Uint8Array) {
    const copy = data.slice()
    queueMicrotask(() => this.handlers.get(channel)?.forEach((h) => h(copy)))
  }
  subscribe(channel: string, handler: (d: Uint8Array) => void) {
    let set = this.handlers.get(channel)
    if (!set) this.handlers.set(channel, (set = new Set()))
    set.add(handler)
    return () => {
      set!.delete(handler)
      if (!set!.size) this.handlers.delete(channel)
    }
  }
}

/** Redis pub/sub. Uses two connections, because a subscribed Redis connection can't publish. */
export async function redisBus(url: string): Promise<Bus> {
  const { Redis } = await import('ioredis')
  const pub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: null })
  const sub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: null })
  const handlers = new Map<string, Set<(d: Uint8Array) => void>>()
  sub.on('messageBuffer', (channel: Buffer, message: Buffer) => {
    const set = handlers.get(channel.toString())
    if (!set) return
    const data = new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
    set.forEach((h) => h(data))
  })
  return {
    publish(channel, data) {
      void pub.publish(channel, Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    },
    subscribe(channel, handler) {
      let set = handlers.get(channel)
      if (!set) {
        handlers.set(channel, (set = new Set()))
        void sub.subscribe(channel)
      }
      set.add(handler)
      return () => {
        set!.delete(handler)
        if (!set!.size) {
          handlers.delete(channel)
          void sub.unsubscribe(channel)
        }
      }
    },
    async close() {
      await Promise.allSettled([pub.quit(), sub.quit()])
    },
  }
}
