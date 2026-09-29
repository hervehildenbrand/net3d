/**
 * Trimmed backbone fixture from the live showcase API.
 * Shape: 2-3 circuits, their physical/isis/sr facts, nodeSids, 4-6 GraphDevices, CircuitGroups with id != cid.
 * Showcase names only (AMS1, FRA1).
 */
import type { CollectorTopology, GraphDevice, CircuitGroup } from '@net3d/shared'

export const FIXTURE_DEVICES: GraphDevice[] = [
  { id: 'dev-ams1-core-01', name: 'AMS1-core-01', siteName: 'AMS1', roleName: 'router', roleColor: '#dc2626' },
  { id: 'dev-ams1-core-02', name: 'AMS1-core-02', siteName: 'AMS1', roleName: 'router', roleColor: '#dc2626' },
  { id: 'dev-fra1-core-01', name: 'FRA1-core-01', siteName: 'FRA1', roleName: 'router', roleColor: '#dc2626' },
  { id: 'dev-fra1-core-02', name: 'FRA1-core-02', siteName: 'FRA1', roleName: 'router', roleColor: '#dc2626' },
]

// Topology with facts and nodeSids - shape matches CollectorTopology
export const FIXTURE_TOPOLOGY: CollectorTopology = {
  facts: [
    // Physical facts
    { layer: 'physical', device: 'AMS1-core-01', iface: 'et-0/0/0', remote: 'FRA1-core-01', remoteIface: 'et-0/0/0', up: true, label: '' },
    { layer: 'physical', device: 'FRA1-core-01', iface: 'et-0/0/0', remote: 'AMS1-core-01', remoteIface: 'et-0/0/0', up: true, label: '' },
    { layer: 'physical', device: 'AMS1-core-02', iface: 'et-0/0/1', remote: 'FRA1-core-02', remoteIface: 'et-0/0/1', up: true, label: '' },
    // IS-IS facts
    { layer: 'isis', device: 'AMS1-core-01', iface: 'et-0/0/0', remote: 'FRA1-core-01', remoteIface: 'et-0/0/0', up: true, label: 'L2 UP' },
    { layer: 'isis', device: 'FRA1-core-01', iface: 'et-0/0/0', remote: 'AMS1-core-01', remoteIface: 'et-0/0/0', up: true, label: 'L2 UP' },
    { layer: 'isis', device: 'AMS1-core-02', iface: 'et-0/0/1', remote: 'FRA1-core-02', remoteIface: 'et-0/0/1', up: true, label: 'L2 UP' },
    { layer: 'isis', device: 'FRA1-core-02', iface: 'et-0/0/1', remote: 'AMS1-core-02', remoteIface: 'et-0/0/1', up: true, label: 'L2 UP' },
    // SR facts (pair-level, no interface)
    { layer: 'sr', device: 'AMS1-core-01', iface: null, remote: 'FRA1-core-01', remoteIface: null, up: true, label: 'adj-SID 24001/24002' },
    { layer: 'sr', device: 'AMS1-core-02', iface: null, remote: 'FRA1-core-02', remoteIface: null, up: true, label: 'adj-SID 24003/24004' },
  ],
  nodeSids: {
    'AMS1-core-01': 16001,
    'AMS1-core-02': 16002,
    'FRA1-core-01': 16003,
    'FRA1-core-02': 16004,
  },
  circuits: [
    // Circuit cids differ from their numeric ids
    { id: 'ARELION-AMS1-FRA1-025', a: { deviceName: 'AMS1-core-01', name: 'et-0/0/0' }, b: { deviceName: 'FRA1-core-01', name: 'et-0/0/0' } },
    { id: 'COGENT-AMS1-FRA1-017', a: { deviceName: 'AMS1-core-02', name: 'et-0/0/1' }, b: { deviceName: 'FRA1-core-02', name: 'et-0/0/1' } },
  ],
}

// CircuitGroups with id != cid (NetBox numeric ids differ from circuit identifiers)
export const FIXTURE_CIRCUIT_GROUPS: CircuitGroup[] = [
  {
    siteA: 'AMS1',
    siteZ: 'FRA1',
    count: 2,
    circuitIds: ['101', '102'], // NetBox numeric ids
    circuits: [
      { id: '101', cid: 'ARELION-AMS1-FRA1-025', provider: 'Arelion', siteA: 'AMS1', siteZ: 'FRA1', commitRate: 100_000_000, status: 'active', description: null },
      { id: '102', cid: 'COGENT-AMS1-FRA1-017', provider: 'Cogent', siteA: 'AMS1', siteZ: 'FRA1', commitRate: 100_000_000, status: 'active', description: null },
    ],
    maxCommitRate: 100_000_000,
  },
]
