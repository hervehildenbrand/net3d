import { describe, expect, test } from 'vitest'
import {
  commitRateToSpeedBucket,
  formatCommitRate,
  speedBucketToLabel,
  speedBucketToWidth,
} from '../src/capacity'

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
})
