export interface RoomStats {
  /** NetBox location name; '' for racks without one. */
  location: string
  rackCount: number
  deviceCount: number
  activeDeviceCount: number
}

/** Per-room rack/device totals for the site view overlay. */
export function computeRoomStats(
  racks: { location: string | null; devices: { status: string }[] }[],
): RoomStats[] {
  const rooms = new Map<string, RoomStats>()
  for (const rack of racks) {
    const location = rack.location ?? ''
    let room = rooms.get(location)
    if (!room) {
      room = { location, rackCount: 0, deviceCount: 0, activeDeviceCount: 0 }
      rooms.set(location, room)
    }
    room.rackCount++
    room.deviceCount += rack.devices.length
    room.activeDeviceCount += rack.devices.filter((d) => d.status === 'active').length
  }
  return [...rooms.values()]
}
