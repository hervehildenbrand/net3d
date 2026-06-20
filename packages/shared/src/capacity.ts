/** Circuit capacity tiers used by the showcase fabric and the map arc styling. */
export type SpeedBucket = '10G' | '100G' | '400G'

/** Ethernet interface speed tiers, derived from a device interface's form-factor type. */
export type EthSpeedBucket = '1G' | '10G' | '25G' | '40G' | '100G' | '400G'

/**
 * Bucket a NetBox/Infrahub interface type string (e.g. "100gbase-x-qsfp28",
 * "1000base-t") to its line rate. The leading number+unit carries the speed:
 * "<n>gbase…" is n Gbps; "<n>base…" (no g) is n Mbps. Non-ethernet types
 * (virtual, lag) and unknown/empty strings have no bucket → null.
 */
export function interfaceSpeedBucket(type: string | null | undefined): EthSpeedBucket | null {
  if (!type) return null
  const m = /^(\d+)(g?)base/i.exec(type)
  if (!m) return null
  const gbps = m[2]!.toLowerCase() === 'g' ? Number(m[1]) : Number(m[1]) / 1000
  if (gbps >= 400) return '400G'
  if (gbps >= 100) return '100G'
  if (gbps >= 40) return '40G'
  if (gbps >= 25) return '25G'
  if (gbps >= 10) return '10G'
  if (gbps >= 1) return '1G'
  return null
}

/** Bucket a NetBox commit_rate (Kbps); rates in between round up, null falls low. */
export function commitRateToSpeedBucket(kbps: number | null): SpeedBucket {
  if (!kbps || kbps <= 10_000_000) return '10G'
  if (kbps <= 100_000_000) return '100G'
  return '400G'
}

/** Leaflet polyline weight per capacity tier. */
export function speedBucketToWidth(bucket: SpeedBucket): number {
  switch (bucket) {
    case '10G':
      return 1.5
    case '100G':
      return 2.5
    case '400G':
      return 4
  }
}

export function speedBucketToLabel(bucket: SpeedBucket): string {
  return `${bucket.slice(0, -1)} Gbps`
}

/** Human-readable form of a commit_rate in Kbps (e.g. 400000000 -> "400 Gbps"). */
export function formatCommitRate(kbps: number | null): string {
  if (!kbps) return 'unknown'
  if (kbps >= 1_000_000) return `${kbps / 1_000_000} Gbps`
  return `${kbps / 1_000} Mbps`
}
