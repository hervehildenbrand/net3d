/** Circuit capacity tiers used by the showcase fabric and the map arc styling. */
export type SpeedBucket = '10G' | '100G' | '400G'

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
