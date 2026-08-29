import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SseBroadcaster } from '../src/events'
import type { FastifyReply } from 'fastify'

function fakeReply() {
  const writes: string[] = []
  const handlers: Record<string, () => void> = {}
  const reply = {
    raw: {
      write: (s: string) => writes.push(s),
      on: (ev: string, cb: () => void) => {
        handlers[ev] = cb
      },
    },
  } as unknown as FastifyReply
  return { reply, writes, close: () => handlers['close']?.() }
}

describe('SseBroadcaster', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('broadcast writes an SSE data frame to every client', () => {
    const b = new SseBroadcaster()
    const a = fakeReply()
    const c = fakeReply()
    b.addClient(a.reply)
    b.addClient(c.reply)
    b.broadcast({ type: 'invalidate', scope: 'site', site: 'AMS1' })
    const frame = 'data: {"type":"invalidate","scope":"site","site":"AMS1"}\n\n'
    expect(a.writes).toContain(frame)
    expect(c.writes).toContain(frame)
    b.close()
  })

  test('drops a client when its connection closes', () => {
    const b = new SseBroadcaster()
    const a = fakeReply()
    b.addClient(a.reply)
    expect(b.clientCount).toBe(1)
    a.close()
    expect(b.clientCount).toBe(0)
    b.close()
  })

  test('sends heartbeat comments to keep proxies from timing out', () => {
    const b = new SseBroadcaster()
    const a = fakeReply()
    b.addClient(a.reply)
    vi.advanceTimersByTime(30_000)
    expect(a.writes.some((w) => w.startsWith(':'))).toBe(true)
    b.close()
  })
})
