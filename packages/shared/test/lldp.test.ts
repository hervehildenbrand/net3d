import { describe, expect, test } from 'vitest'
import { lldpDiff } from '../src/lldp'

const cables = [
  {
    id: 'c1',
    a: { deviceName: 'rt1', name: 'et-0/0/0' },
    b: { deviceName: 'rt2', name: 'et-0/0/0' },
  },
  {
    id: 'c2',
    a: { deviceName: 'sw1', name: 'ge-0/0/1' },
    b: { deviceName: 'rt1', name: 'et-0/0/1' },
  },
  { id: 'c3', a: { deviceName: 'rt1', name: 'console' }, b: { deviceName: 'con1', name: 'p3' } },
]

describe('lldpDiff', () => {
  test('confirms documented links seen by LLDP (FQDN hostnames match short names)', () => {
    const diff = lldpDiff(
      { 'et-0/0/0': [{ hostname: 'rt2.infra.example.net', port: 'et-0/0/0' }] },
      cables,
      'rt1',
    )
    expect(diff.matches).toEqual([
      { cableId: 'c1', localInterface: 'et-0/0/0', neighbor: 'rt2.infra.example.net', neighborPort: 'et-0/0/0' },
    ])
  })

  test('flags documented-but-unseen links as cableOnly, ignoring non-interface cables', () => {
    const diff = lldpDiff({}, cables, 'rt1')
    const ids = diff.cableOnly.map((c) => c.cableId)
    expect(ids).toContain('c1')
    expect(ids).toContain('c2')
    expect(ids).not.toContain('c3') // console runs never appear in LLDP
  })

  test('flags LLDP neighbors with no documented cable as lldpOnly', () => {
    const diff = lldpDiff(
      { 'et-0/0/5': [{ hostname: 'mystery-switch', port: 'xe-0/0/9' }] },
      cables,
      'rt1',
    )
    expect(diff.lldpOnly).toEqual([
      { localInterface: 'et-0/0/5', neighbor: 'mystery-switch', neighborPort: 'xe-0/0/9' },
    ])
  })

  test('neighbor hostname mismatch counts as cableOnly AND lldpOnly', () => {
    const diff = lldpDiff(
      { 'et-0/0/0': [{ hostname: 'wrong-device', port: 'et-0/0/7' }] },
      cables,
      'rt1',
    )
    expect(diff.cableOnly.map((c) => c.cableId)).toContain('c1')
    expect(diff.lldpOnly.map((l) => l.neighbor)).toContain('wrong-device')
  })
})
