/** Max NAPALM/LLDP calls in flight from this client — each is a ~25 s SSH behind NetBox. */
const MAX_CONCURRENT = 3

type Release = () => void

export class LldpSemaphore {
  private inFlight = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly maxConcurrent: number) {}

  async acquire(signal: AbortSignal): Promise<Release> {
    signal.throwIfAborted()
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight++
      return this.releaseOnce()
    }

    return new Promise<Release>((resolve, reject) => {
      const onAbort = () => {
        this.waiters.splice(this.waiters.indexOf(grant), 1)
        reject(signal.reason)
      }
      const grant = () => {
        signal.removeEventListener('abort', onAbort)
        resolve(this.releaseOnce())
      }
      this.waiters.push(grant)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private releaseOnce(): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      const grant = this.waiters.shift()
      if (grant) grant()
      else this.inFlight--
    }
  }
}

const lldpSemaphore = new LldpSemaphore(MAX_CONCURRENT)

export async function withLldpSlot<T>(
  signal: AbortSignal,
  request: () => Promise<T>,
): Promise<T> {
  const release = await lldpSemaphore.acquire(signal)
  try {
    return await request()
  } finally {
    release()
  }
}
