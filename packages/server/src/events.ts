import type { FastifyReply } from 'fastify'

export interface InvalidateEvent {
  type: 'invalidate'
  scope: 'site' | 'all'
  site?: string
}

/** Fan-out of invalidation events to connected SSE clients. Single-process. */
export class SseBroadcaster {
  private clients = new Set<FastifyReply>()
  private heartbeat: NodeJS.Timeout

  constructor() {
    // comment frames defeat idle timeouts in nginx/vite-proxy between events
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) c.raw.write(': hb\n\n')
    }, 25_000)
    this.heartbeat.unref?.()
  }

  get clientCount(): number {
    return this.clients.size
  }

  addClient(reply: FastifyReply): void {
    this.clients.add(reply)
    reply.raw.on('close', () => this.clients.delete(reply))
  }

  broadcast(event: InvalidateEvent): void {
    const frame = `data: ${JSON.stringify(event)}\n\n`
    for (const c of this.clients) c.raw.write(frame)
  }

  close(): void {
    clearInterval(this.heartbeat)
  }
}
