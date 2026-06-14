/** Site power panels + feeds, for the room-view chain visual and the power legend. */

export interface RawPowerPanel {
  id: string
  name: string
  location: { name: string } | null
}

export interface RawPowerFeed {
  id: string
  name: string
  status: string
  voltage: number | null
  amperage: number | null
  phase: string | null
  supply: string | null
  type: string | null
  max_utilization: number | null
  power_panel: { name: string } | null
  rack: { name: string } | null
}

export interface RawSitePower {
  power_panel_list: RawPowerPanel[]
  power_feed_list: RawPowerFeed[]
}

export interface SitePowerPanel {
  id: string
  name: string
  location: string | null
}

export interface SitePowerFeed {
  id: string
  name: string
  status: string
  voltage: number | null
  amperage: number | null
  phase: string | null
  supply: string | null
  type: string | null
  maxUtilization: number | null
  /** Feeding panel name; null when unset. */
  panelName: string | null
  /** Rack this feed serves; null when unassigned. */
  rackName: string | null
}

export interface SitePower {
  panels: SitePowerPanel[]
  feeds: SitePowerFeed[]
}

/** Map NetBox power-panel/feed rows into the SitePower shape (enum casing normalized). */
export function normalizeRawPower(raw: RawSitePower): SitePower {
  return {
    panels: raw.power_panel_list.map((p) => ({
      id: p.id,
      name: p.name,
      location: p.location?.name ?? null,
    })),
    feeds: raw.power_feed_list.map((f) => ({
      id: f.id,
      name: f.name,
      // NetBox 4.x (Strawberry) returns enums lowercase; normalize for stable display
      status: (f.status ?? '').toLowerCase(),
      voltage: f.voltage ?? null,
      amperage: f.amperage ?? null,
      phase: f.phase ?? null,
      supply: f.supply ?? null,
      type: f.type ?? null,
      maxUtilization: f.max_utilization ?? null,
      panelName: f.power_panel?.name ?? null,
      rackName: f.rack?.name ?? null,
    })),
  }
}
