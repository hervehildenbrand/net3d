import { describe, expect, test } from 'vitest'
import { createSoTClient, getSoTConfigFromEnv } from '../../src/sot/factory'
import { NapalmUnreachableError } from '../../src/sot/errors'

describe('getSoTConfigFromEnv', () => {
  test('defaults to the netbox backend when SOT_BACKEND is unset', () => {
    const cfg = getSoTConfigFromEnv({ NETBOX_URL: 'http://nb', NETBOX_TOKEN: 't' })
    expect(cfg.backend).toBe('netbox')
    expect(cfg.netbox.url).toBe('http://nb')
    expect(cfg.netbox.token).toBe('t')
  })

  test('selects infrahub and reads its connection vars', () => {
    const cfg = getSoTConfigFromEnv({
      SOT_BACKEND: 'infrahub',
      INFRAHUB_URL: 'http://ih:8000',
      INFRAHUB_TOKEN: 'k',
    })
    expect(cfg.backend).toBe('infrahub')
    expect(cfg.infrahub.url).toBe('http://ih:8000')
    expect(cfg.infrahub.token).toBe('k')
    expect(cfg.infrahub.branch).toBe('main')
  })

  test('reads the INFRAHUB_BRANCH override', () => {
    const cfg = getSoTConfigFromEnv({ SOT_BACKEND: 'infrahub', INFRAHUB_BRANCH: 'staging' })
    expect(cfg.infrahub.branch).toBe('staging')
  })

  test('tlsVerify defaults true and is false only on the literal "false"', () => {
    expect(getSoTConfigFromEnv({}).netbox.tlsVerify).toBe(true)
    expect(getSoTConfigFromEnv({ NETBOX_TLS_VERIFY: 'false' }).netbox.tlsVerify).toBe(false)
    expect(getSoTConfigFromEnv({ INFRAHUB_TLS_VERIFY: 'false' }).infrahub.tlsVerify).toBe(false)
  })

  test('throws on an unrecognized SOT_BACKEND', () => {
    expect(() => getSoTConfigFromEnv({ SOT_BACKEND: 'mystery' })).toThrow(/SOT_BACKEND/)
  })
})

describe('createSoTClient', () => {
  test('builds a NetBox client when configured for netbox', () => {
    const client = createSoTClient(getSoTConfigFromEnv({ NETBOX_URL: 'http://nb', NETBOX_TOKEN: 't' }))
    expect(typeof client.getSites).toBe('function')
    expect(typeof client.getStatus).toBe('function')
  })

  test('throws a clear error when netbox url/token are missing', () => {
    expect(() => createSoTClient(getSoTConfigFromEnv({ SOT_BACKEND: 'netbox' }))).toThrow(/NETBOX_URL/)
  })

  test('builds an Infrahub client that reports the infrahub backend', async () => {
    const client = createSoTClient(
      getSoTConfigFromEnv({ SOT_BACKEND: 'infrahub', INFRAHUB_URL: 'http://ih', INFRAHUB_TOKEN: 'k' }),
    )
    expect((await client.getStatus()).backend).toBe('infrahub')
  })

  test('throws a clear error when infrahub url/token are missing', () => {
    expect(() => createSoTClient(getSoTConfigFromEnv({ SOT_BACKEND: 'infrahub' }))).toThrow(/INFRAHUB_URL/)
  })

  test('Infrahub has no live device queries: napalm rejects as unreachable', async () => {
    const client = createSoTClient(
      getSoTConfigFromEnv({ SOT_BACKEND: 'infrahub', INFRAHUB_URL: 'http://ih', INFRAHUB_TOKEN: 'k' }),
    )
    await expect(client.napalm(1, 'get_facts')).rejects.toBeInstanceOf(NapalmUnreachableError)
  })
})
