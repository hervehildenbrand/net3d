import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import {
  parseNetboxWebhook,
  parseInfrahubWebhook,
  verifyNetboxSignature,
  verifyInfrahubSignature,
} from '../src/webhooks'

describe('parseNetboxWebhook', () => {
  test('site event returns its own name', () => {
    expect(parseNetboxWebhook({ event: 'updated', model: 'site', data: { name: 'AMS1' } })).toEqual(
      { sites: ['AMS1'] },
    )
  })

  test('device/rack/powerpanel/powerfeed use data.site.name', () => {
    for (const model of ['device', 'rack', 'powerpanel', 'powerfeed']) {
      expect(
        parseNetboxWebhook({ event: 'created', model, data: { site: { name: 'FRA1' } } }),
      ).toEqual({ sites: ['FRA1'] })
    }
  })

  test('cable event collects sites from both terminations, deduped', () => {
    const data = {
      a_terminations: [{ object: { device: { site: { name: 'AMS1' } } } }],
      b_terminations: [{ object: { device: { site: { name: 'AMS1' } } } }],
    }
    expect(parseNetboxWebhook({ event: 'created', model: 'cable', data })).toEqual({
      sites: ['AMS1'],
    })
  })

  test('cable spanning two sites reports both', () => {
    const data = {
      a_terminations: [{ object: { device: { site: { name: 'AMS1' } } } }],
      b_terminations: [{ object: { device: { site: { name: 'FRA1' } } } }],
    }
    expect(parseNetboxWebhook({ event: 'created', model: 'cable', data })).toEqual({
      sites: ['AMS1', 'FRA1'],
    })
  })

  test('falls back to scope all when site is underivable', () => {
    expect(parseNetboxWebhook({ event: 'created', model: 'cable', data: {} })).toEqual({
      scope: 'all',
    })
    expect(parseNetboxWebhook({ event: 'updated', model: 'vlan', data: {} })).toEqual({
      scope: 'all',
    })
    expect(parseNetboxWebhook(null)).toEqual({ scope: 'all' })
  })
})

describe('parseInfrahubWebhook', () => {
  test('always coarse — no site linkage in Infrahub payloads', () => {
    expect(
      parseInfrahubWebhook({ event: 'infrahub.node.updated', data: { kind: 'DcimDevice' } }),
    ).toEqual({ scope: 'all' })
  })
})

describe('verifyNetboxSignature', () => {
  const body = '{"model":"site"}'
  const secret = 's3cret'
  const good = createHmac('sha512', secret).update(body).digest('hex')

  test('accepts a valid HMAC-SHA512 hex digest', () => {
    expect(verifyNetboxSignature(body, good, secret)).toBe(true)
  })

  test('rejects wrong signature and wrong length', () => {
    expect(verifyNetboxSignature(body, good.replace(/^./, good[0] === 'f' ? '0' : 'f'), secret)).toBe(false)
    expect(verifyNetboxSignature(body, 'short', secret)).toBe(false)
  })
})

describe('verifyInfrahubSignature', () => {
  const id = 'msg_1'
  const ts = '1730000000'
  const body = '{"event":"infrahub.node.updated"}'
  const secret = 'whsec'
  const good = 'v1,' + createHmac('sha256', secret).update(`${id}.${ts}.${body}`).digest('base64')

  test('accepts a valid standard-webhooks signature', () => {
    expect(verifyInfrahubSignature(id, ts, body, good, secret)).toBe(true)
  })

  test('rejects bad prefix or bad digest', () => {
    expect(verifyInfrahubSignature(id, ts, body, good.slice(3), secret)).toBe(false)
    expect(verifyInfrahubSignature(id, ts, body, 'v1,AAAA', secret)).toBe(false)
  })
})
