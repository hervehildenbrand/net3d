// The single seam between net3d's core (routes, cache, prewarm, UI) and any
// source of truth. NetBox and Infrahub each provide a createXClient() that
// returns this interface; nothing above it knows which backend is active.

import type { SiteCircuit } from '@net3d/shared'
import type { SiteCable } from '../cables'
import type { SitePower } from '../power'
import type { Site, SiteRack, SoTStatus } from './types'

export interface SoTClient {
  getSites(): Promise<Site[]>
  getCircuits(): Promise<SiteCircuit[]>
  getSiteRacks(site: string): Promise<SiteRack[]>
  getSiteCables(site: string): Promise<SiteCable[]>
  getSitePower(site: string): Promise<SitePower>
  napalm(deviceId: number, method: string): Promise<unknown>
  getStatus(): Promise<SoTStatus>
}
