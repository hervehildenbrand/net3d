import { createHmac, timingSafeEqual } from 'node:crypto'

/** Which caches a webhook affects: specific sites, or everything. */
export type WebhookImpact = { sites: string[] } | { scope: 'all' }

const SITE_LINKED_MODELS = new Set(['device', 'rack', 'powerpanel', 'powerfeed'])

export function parseNetboxWebhook(body: unknown): WebhookImpact {
  const p = body as { model?: string; data?: Record<string, unknown> } | null
  if (!p?.model || !p.data) return { scope: 'all' }

  if (p.model === 'site') {
    const name = (p.data as { name?: string }).name
    return name ? { sites: [name] } : { scope: 'all' }
  }
  if (SITE_LINKED_MODELS.has(p.model)) {
    const site = (p.data as { site?: { name?: string } }).site?.name
    return site ? { sites: [site] } : { scope: 'all' }
  }
  if (p.model === 'cable') {
    const sites = new Set<string>()
    for (const side of ['a_terminations', 'b_terminations']) {
      const terms = (p.data as Record<string, unknown>)[side]
      if (!Array.isArray(terms)) continue
      for (const t of terms) {
        const site = (t as { object?: { device?: { site?: { name?: string } } } })?.object?.device
          ?.site?.name
        if (site) sites.add(site)
      }
    }
    return sites.size ? { sites: [...sites] } : { scope: 'all' }
  }
  return { scope: 'all' }
}

export function parseInfrahubWebhook(_body: unknown): WebhookImpact {
  // ponytail: Infrahub node payloads don't carry a resolvable site — coarse
  // invalidation; parse data.changelog relationships if this gets too chatty.
  return { scope: 'all' }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** NetBox: X-Hook-Signature = HMAC-SHA512 hex of the raw request body. */
export function verifyNetboxSignature(rawBody: string, header: string, secret: string): boolean {
  return safeEqual(header, createHmac('sha512', secret).update(rawBody).digest('hex'))
}

/** Infrahub (Standard Webhooks): webhook-signature = v1,base64(HMAC-SHA256("id.ts.body")). */
export function verifyInfrahubSignature(
  id: string,
  timestamp: string,
  rawBody: string,
  header: string,
  secret: string,
): boolean {
  const expected =
    'v1,' + createHmac('sha256', secret).update(`${id}.${timestamp}.${rawBody}`).digest('base64')
  return safeEqual(header, expected)
}
