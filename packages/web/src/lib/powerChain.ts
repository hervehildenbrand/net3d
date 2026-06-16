import type { SitePower, SiteRack } from '../hooks/useSiteDetail'
import { pduSide, type FeedSide } from './powerOverlay'

/** What the user clicked to root a power-chain trace. */
export interface PowerSource {
  kind: 'panel' | 'feed'
  /** Panel or feed name (matches SitePowerFeed.panelName / .name). */
  name: string
}

/** Everything downstream of a power source — the impact set if it fails. */
export interface PowerChain {
  feedNames: Set<string>
  rackIds: Set<string>
  deviceNames: Set<string>
  sides: Set<FeedSide>
}

const empty = (): PowerChain => ({
  feedNames: new Set(),
  rackIds: new Set(),
  deviceNames: new Set(),
  sides: new Set(),
})

/**
 * Trace a power source to its impact set: panel -> feeds (feed.panelName) -> racks
 * (feed.rackName) -> the devices in those racks. Backend-agnostic — uses only the
 * panel/feed data both NetBox and Infrahub return, so a feed/panel failure reads the
 * same on either backend. Granularity is the rack: anything in a fed rack is flagged
 * (per-device A/B cabling isn't modeled on every backend, so we don't claim it).
 */
export function tracePowerChain(
  racks: SiteRack[],
  power: SitePower | undefined,
  source: PowerSource,
): PowerChain {
  if (!power) return empty()

  const feeds = power.feeds.filter((f) =>
    source.kind === 'feed' ? f.name === source.name : f.panelName === source.name,
  )
  if (feeds.length === 0) return empty()

  const feedNames = new Set<string>()
  const rackNames = new Set<string>()
  const sides = new Set<FeedSide>()
  for (const f of feeds) {
    feedNames.add(f.name)
    if (f.rackName) rackNames.add(f.rackName)
    const side = pduSide(f.name)
    if (side) sides.add(side)
  }

  const rackIds = new Set<string>()
  const deviceNames = new Set<string>()
  for (const r of racks) {
    if (!rackNames.has(r.name)) continue
    rackIds.add(r.id)
    for (const d of r.devices) {
      if (d.position != null) deviceNames.add(d.name) // skip unracked/child devices
    }
  }

  return { feedNames, rackIds, deviceNames, sides }
}
