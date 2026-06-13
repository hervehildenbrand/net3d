import { describe, expect, test } from 'vitest'
import { normalizeRawRacks, type RawRack } from '../src/netbox'

const device = (over: Partial<RawRack['devices'][number]> = {}): RawRack['devices'][number] => ({
  id: '1771',
  name: 'edge-router-1',
  position: 20,
  face: 'FRONT',
  role: { name: 'router_rtcore', color: '9c27b0' },
  device_type: {
    u_height: 1,
    model: 'ptx10001_36mr',
    is_full_depth: true,
    manufacturer: { name: 'Juniper' },
  },
  ...over,
})

const rack = (over: Partial<RawRack> = {}): RawRack => ({
  id: '376',
  name: 'C32-WAN1',
  u_height: 47,
  location: null,
  devices: [device()],
  ...over,
})

describe('normalizeRawRacks', () => {
  test('maps a rack with its device into the SiteRack shape', () => {
    const [r] = normalizeRawRacks([rack()])
    expect(r).toEqual({
      id: '376',
      name: 'C32-WAN1',
      uHeight: 47,
      location: null,
      devices: [
        {
          id: '1771',
          name: 'edge-router-1',
          position: 20,
          face: 'FRONT',
          roleName: 'router_rtcore',
          roleColor: '9c27b0',
          uHeight: 1,
          model: 'ptx10001_36mr',
          manufacturer: 'Juniper',
          isFullDepth: true,
          status: 'active',
          serial: null,
          assetTag: null,
          description: null,
          platform: null,
          primaryIp: null,
          oobIp: null,
        },
      ],
    })
  })

  test('maps inventory fields (serial, asset tag, platform, mgmt + oob IP, description)', () => {
    const [r] = normalizeRawRacks([
      rack({
        devices: [
          device({
            serial: 'JN123ABC',
            asset_tag: 'ASSET-42',
            description: 'spine in pod 1',
            platform: { name: 'Juniper Junos' },
            primary_ip4: { address: '10.0.0.5/24' },
            oob_ip: { address: '192.168.99.5/24' },
          }),
        ],
      }),
    ])
    const d = r!.devices[0]!
    expect(d.serial).toBe('JN123ABC')
    expect(d.assetTag).toBe('ASSET-42')
    expect(d.description).toBe('spine in pod 1')
    expect(d.platform).toBe('Juniper Junos')
    expect(d.primaryIp).toBe('10.0.0.5/24')
    expect(d.oobIp).toBe('192.168.99.5/24')
  })

  test('normalizes NetBox 4.x lowercase face to uppercase (app compares REAR)', () => {
    const [r] = normalizeRawRacks([rack({ devices: [device({ face: 'rear' })] })])
    expect(r!.devices[0]!.face).toBe('REAR')
  })

  test('keeps a null face null', () => {
    const [r] = normalizeRawRacks([rack({ devices: [device({ face: null })] })])
    expect(r!.devices[0]!.face).toBeNull()
  })

  test('normalizes device status to lowercase, defaulting to active when absent', () => {
    const [r] = normalizeRawRacks([
      rack({ devices: [device({ status: 'OFFLINE' }), device({ id: '2', name: 'd2' })] }),
    ])
    expect(r!.devices[0]!.status).toBe('offline')
    expect(r!.devices[1]!.status).toBe('active')
  })

  test('parses hardware specs from device_type custom fields', () => {
    const [r] = normalizeRawRacks([
      rack({
        devices: [
          device({
            device_type: {
              u_height: 1,
              model: 'PowerEdge R650',
              is_full_depth: true,
              manufacturer: { name: 'Dell' },
              custom_fields: {
                cpu_model: '2x Intel Xeon Gold 6338 (32c)',
                cpu_cores: 64,
                ram_gb: 512,
                storage_tb: '7.68',
              },
            },
          }),
        ],
      }),
    ])
    expect(r!.devices[0]!.specs).toEqual({
      cpuModel: '2x Intel Xeon Gold 6338 (32c)',
      cpuCores: 64,
      ramGb: 512,
      storageTb: 7.68,
    })
  })

  test('specs are undefined when custom fields are absent or empty (3.7 instances)', () => {
    const [plain] = normalizeRawRacks([rack()])
    expect(plain!.devices[0]!.specs).toBeUndefined()
    const [empty] = normalizeRawRacks([
      rack({
        devices: [
          device({
            device_type: {
              u_height: 1, model: 'x', is_full_depth: true, manufacturer: null,
              custom_fields: { cpu_model: null },
            },
          }),
        ],
      }),
    ])
    expect(empty!.devices[0]!.specs).toBeUndefined()
  })

  test('coerces string decimals and falls back for missing role/manufacturer', () => {
    const [r] = normalizeRawRacks([
      rack({
        devices: [
          device({
            position: '20',
            role: null,
            device_type: { u_height: '2', model: 'x', is_full_depth: false, manufacturer: null },
          }),
        ],
      }),
    ])
    const d = r!.devices[0]!
    expect(d.position).toBe(20)
    expect(d.uHeight).toBe(2)
    expect(d.roleName).toBe('unknown')
    expect(d.roleColor).toBe('888888')
    expect(d.manufacturer).toBe('unknown')
  })
})
