import { describe, expect, test } from 'vitest'
import {
  commitRateToSpeedBucket,
  formatBps,
  formatCommitRate,
  interfaceSpeedBucket,
  speedBucketToLabel,
  speedBucketToWidth,
} from '../src/capacity'

describe('interfaceSpeedBucket', () => {
  test('buckets the four seeded interface types', () => {
    expect(interfaceSpeedBucket('1000base-t')).toBe('1G')
    expect(interfaceSpeedBucket('10gbase-x-sfpp')).toBe('10G')
    expect(interfaceSpeedBucket('25gbase-x-sfp28')).toBe('25G')
    expect(interfaceSpeedBucket('100gbase-x-qsfp28')).toBe('100G')
  })

  test('handles 40G and 400G form factors', () => {
    expect(interfaceSpeedBucket('40gbase-x-qsfpp')).toBe('40G')
    expect(interfaceSpeedBucket('400gbase-x-qsfpdd')).toBe('400G')
  })

  test('is case-insensitive', () => {
    expect(interfaceSpeedBucket('100GBASE-X-QSFP28')).toBe('100G')
  })

  test('non-ethernet / unknown / null types have no bucket', () => {
    expect(interfaceSpeedBucket('virtual')).toBe(null)
    expect(interfaceSpeedBucket('lag')).toBe(null)
    expect(interfaceSpeedBucket(null)).toBe(null)
    expect(interfaceSpeedBucket(undefined)).toBe(null)
  })
})

describe('commitRateToSpeedBucket', () => {
  test('buckets the three seeded rates', () => {
    expect(commitRateToSpeedBucket(10_000_000)).toBe('10G')
    expect(commitRateToSpeedBucket(100_000_000)).toBe('100G')
    expect(commitRateToSpeedBucket(400_000_000)).toBe('400G')
  })

  test('rates in between round up to the next bucket', () => {
    expect(commitRateToSpeedBucket(25_000_000)).toBe('100G')
    expect(commitRateToSpeedBucket(200_000_000)).toBe('400G')
  })

  test('null/zero rates fall back to the smallest bucket', () => {
    expect(commitRateToSpeedBucket(null)).toBe('10G')
    expect(commitRateToSpeedBucket(0)).toBe('10G')
  })
})

describe('speedBucketToWidth', () => {
  test('width grows with capacity', () => {
    expect(speedBucketToWidth('10G')).toBeLessThan(speedBucketToWidth('100G'))
    expect(speedBucketToWidth('100G')).toBeLessThan(speedBucketToWidth('400G'))
  })
})

describe('labels', () => {
  test('bucket labels are human readable', () => {
    expect(speedBucketToLabel('10G')).toBe('10 Gbps')
    expect(speedBucketToLabel('400G')).toBe('400 Gbps')
  })

  test('formatCommitRate renders Kbps rates as G/M', () => {
    expect(formatCommitRate(400_000_000)).toBe('400 Gbps')
    expect(formatCommitRate(10_000_000)).toBe('10 Gbps')
    expect(formatCommitRate(500_000)).toBe('500 Mbps')
    expect(formatCommitRate(null)).toBe('unknown')
  })

  test('test_formatBps_scales_and_rounds', () => {
    expect(formatBps(0)).toBe('0 bps')
    expect(formatBps(950.4)).toBe('950 bps')
    expect(formatBps(999_950)).toBe('1 Mbps')
    expect(formatBps(1_250_000_000)).toBe('1.3 Gbps')
    expect(formatBps(12.3e9)).toBe('12.3 Gbps')
    expect(formatBps(4e11)).toBe('400 Gbps')
  })
})
