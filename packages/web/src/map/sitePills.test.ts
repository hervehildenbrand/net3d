import { describe, expect, test } from 'vitest'
import type { LogicalGraph, LogicalNode } from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import {
  sitePills,
  offsetLatLngPx,
  nodeAnchors,
  shortName,
  pillLabelRows,
  pillHtml,
  pillObstacles,
  escapeHtml,
  SEG_PX,
  PILL_W,
  HIT_PX,
  LABEL_ZOOM,
  type SitePill,
} from './sitePills'

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const site = (name: string, latitude: number | null, longitude: number | null, role: 'compute' | 'pop' | null = 'compute'): Site =>
  ({ name, latitude, longitude, role } as Site)

const SITES: Site[] = [
  site('AMS1', 52.37, 4.89),
  site('FRA1', 50.11, 8.68),
  site('NULL_SITE', null, null),
]

const mkNode = (id: string, siteName: string, sid: number | null = null, tier: LogicalNode['tier'] = 'remote'): LogicalNode => ({
  id,
  name: id,
  tier,
  siteName,
  device: tier === 'remote' ? { id: `dev-${id}`, name: id, siteName, roleName: 'router', roleColor: '#ccc' } : null,
  sid,
})

// ─────────────────────────────────────────────────────────────────────────────
// sitePills tests
// ─────────────────────────────────────────────────────────────────────────────

describe('sitePills', () => {
  test('test_sitePills_twoRoutersPerSite_naturalNameOrder', () => {
    // Nodes listed in reverse order to prove the sort
    const nodes = [
      mkNode('AMS1-core-02', 'AMS1', 16002),
      mkNode('AMS1-core-01', 'AMS1', 16001),
    ]
    const graph: LogicalGraph = { nodes, edges: [] }
    const pills = sitePills(graph, SITES)
    // 2 pills: AMS1 (with routers) + FRA1 (plain, no routers in graph)
    expect(pills.size).toBe(2)
    const ams1Pill = pills.get('AMS1')!
    expect(ams1Pill.routers).toHaveLength(2)
    // Natural order: core-01 before core-02
    expect(ams1Pill.routers[0]!.name).toBe('AMS1-core-01')
    expect(ams1Pill.routers[1]!.name).toBe('AMS1-core-02')
    // FRA1 has a plain pill (no routers)
    const fra1Pill = pills.get('FRA1')!
    expect(fra1Pill.routers).toHaveLength(0)
  })

  test('test_sitePills_siteNodesAndSitesWithoutCoordinates_excluded', () => {
    const nodes = [
      mkNode('AMS1-core-01', 'AMS1'),
      mkNode('MIA1-core-01', 'MIA1'), // A real router node for MIA1
      { id: 'site:MIA1', name: 'MIA1', tier: 'remote' as const, siteName: 'MIA1', device: null, sid: null },
      mkNode('NULLSITE-core-01', 'NULL_SITE'),
    ]
    const graph: LogicalGraph = { nodes, edges: [] }
    const sitesWithNull = [...SITES, site('MIA1', 25.76, -80.19)]
    const pills = sitePills(graph, sitesWithNull)
    // Only AMS1 and MIA1 should have pills (geocoded sites with device nodes)
    expect(pills.has('AMS1')).toBe(true)
    expect(pills.has('MIA1')).toBe(true)
    // NULL_SITE excluded (no coordinates)
    expect(pills.has('NULL_SITE')).toBe(false)
    // site: nodes excluded from routers list
    expect(pills.get('MIA1')!.routers.every((r) => !r.id.startsWith('site:'))).toBe(true)
  })

  test('test_sitePills_nullGraph_plainPillsForAllGeocodedSites', () => {
    // With null graph (backbone 503), we still get plain pills for all geocoded sites
    const pills = sitePills(null, SITES)
    // 2 geocoded sites: AMS1 and FRA1 (NULL_SITE excluded)
    expect(pills.size).toBe(2)
    expect(pills.has('AMS1')).toBe(true)
    expect(pills.has('FRA1')).toBe(true)
    expect(pills.has('NULL_SITE')).toBe(false)
    // All pills are plain (no routers)
    expect(pills.get('AMS1')!.routers).toHaveLength(0)
    expect(pills.get('FRA1')!.routers).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// offsetLatLngPx tests
// ─────────────────────────────────────────────────────────────────────────────

describe('offsetLatLngPx', () => {
  test('test_offsetLatLngPx_equatorZoom2_eightPxIsAbout2p81Degrees', () => {
    // At equator (lat 0), zoom 2: W = 256 * 2^2 = 1024 px
    // 8 px offset in y maps to a change in latitude
    // Mercator y = W * (0.5 - ln(tan(π/4 + φ/2)) / 2π)
    // At equator, the derivative dy/dφ ≈ W / (2π) → dφ ≈ 2π * dy / W
    // For dy = 8 px, dφ ≈ 2π * 8 / 1024 ≈ 0.049 rad ≈ 2.81°
    const [lat, lng] = offsetLatLngPx(0, 10, 8, 2)
    expect(lng).toBeCloseTo(10, 9) // Longitude unchanged
    const deltaLat = Math.abs(lat - 0)
    expect(deltaLat).toBeCloseTo(2.81, 1)
  })

  test('test_offsetLatLngPx_oneZoomUp_halvesOffset', () => {
    // At zoom 3 (double the resolution), same 8 px offset should give half the delta
    const [lat2] = offsetLatLngPx(0, 0, 8, 2)
    const [lat3] = offsetLatLngPx(0, 0, 8, 3)
    const delta2 = Math.abs(lat2 - 0)
    const delta3 = Math.abs(lat3 - 0)
    expect(delta3).toBeCloseTo(delta2 / 2, 1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// nodeAnchors tests
// ─────────────────────────────────────────────────────────────────────────────

describe('nodeAnchors', () => {
  test('test_nodeAnchors_twoRouters_segmentCentresPlusMinusHalfPitchInPx', () => {
    const nodes = [
      mkNode('AMS1-core-01', 'AMS1', 16001),
      mkNode('AMS1-core-02', 'AMS1', 16002),
    ]
    const graph: LogicalGraph = { nodes, edges: [] }
    const pills = sitePills(graph, SITES)
    const zoom = 2
    const anchors = nodeAnchors(pills, SITES, zoom)

    // Site centre
    const siteLat = 52.37
    const siteLng = 4.89

    // Get anchors for both routers
    const anchor1 = anchors.get('AMS1-core-01')!
    const anchor2 = anchors.get('AMS1-core-02')!

    // Both should have the same longitude
    expect(anchor1[1]).toBeCloseTo(siteLng, 9)
    expect(anchor2[1]).toBeCloseTo(siteLng, 9)

    // For 2 routers: i=0 -> offset (0 - 0.5)*8 = -4 px, i=1 -> offset (1 - 0.5)*8 = +4 px
    // At zoom 2, 4 px = ~1.4 degrees latitude at equator, less at higher latitudes
    // Just check that they're offset symmetrically around the site centre
    // At zoom 2 the offset is larger in lat degrees. Use 1 decimal place due to Mercator distortion.
    const avgLat = (anchor1[0] + anchor2[0]) / 2
    expect(avgLat).toBeCloseTo(siteLat, 1)

    // And they're offset in opposite directions
    expect(anchor1[0]).not.toBeCloseTo(anchor2[0], 3)
  })

  test('test_nodeAnchors_siteNode_anchoredAtSiteCentre', () => {
    const nodes: LogicalNode[] = [
      { id: 'site:FRA1', name: 'FRA1', tier: 'remote', siteName: 'FRA1', device: null, sid: null },
    ]
    const graph: LogicalGraph = { nodes, edges: [] }
    const pills = sitePills(graph, SITES)
    // Also include FRA1 in sites for site centre lookup
    const sitesWithFra1 = SITES.map((s) => s)
    const anchors = nodeAnchors(pills, sitesWithFra1, 2)

    const anchor = anchors.get('site:FRA1')!
    expect(anchor[0]).toBeCloseTo(50.11, 9)
    expect(anchor[1]).toBeCloseTo(8.68, 9)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// shortName tests
// ─────────────────────────────────────────────────────────────────────────────

describe('shortName', () => {
  test('test_shortName_sitePrefixedFqdn_stripsSiteAndDomain', () => {
    expect(shortName('AMS1-core-01.example.net', 'AMS1')).toBe('core-01')
  })

  test('test_shortName_foreignPrefix_keepsHostPart', () => {
    // If the prefix doesn't match the site, keep the full host part
    expect(shortName('FRA1-core-01.example.net', 'AMS1')).toBe('fra1-core-01')
  })

  test('test_shortName_lowercaseFqdn_stripsSiteAndDomain', () => {
    // Production hostnames are often lowercase FQDNs
    expect(shortName('ams1-core-01.example.net', 'AMS1')).toBe('core-01')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// pillLabelRows tests
// ─────────────────────────────────────────────────────────────────────────────

describe('pillLabelRows', () => {
  test('test_pillLabelRows_srVisibleWithSid_appendsSid', () => {
    const pill: SitePill = {
      site: SITES[0]!,
      routers: [mkNode('AMS1-core-01', 'AMS1', 16001)],
    }
    const rows = pillLabelRows(pill, true)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('16001')
  })

  test('test_pillLabelRows_srHiddenOrNullSid_nameOnly', () => {
    const pillWithSid: SitePill = {
      site: SITES[0]!,
      routers: [mkNode('AMS1-core-01', 'AMS1', 16001)],
    }
    const pillNoSid: SitePill = {
      site: SITES[0]!,
      routers: [mkNode('AMS1-core-02', 'AMS1', null)],
    }
    // SR hidden
    const rowsHidden = pillLabelRows(pillWithSid, false)
    expect(rowsHidden).toHaveLength(1)
    expect(rowsHidden[0]).not.toContain('16001')

    // No SID
    const rowsNoSid = pillLabelRows(pillNoSid, true)
    expect(rowsNoSid).toHaveLength(1)
    expect(rowsNoSid[0]).not.toContain('null')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// pillHtml tests
// ─────────────────────────────────────────────────────────────────────────────

describe('pillHtml', () => {
  test('test_pillHtml_twoRouters_twoSegmentsInRoleColours', () => {
    const pill: SitePill = {
      site: SITES[0]!,
      routers: [
        mkNode('AMS1-core-01', 'AMS1', 16001),
        mkNode('AMS1-core-02', 'AMS1', 16002),
      ],
    }
    const html = pillHtml(pill)
    // Should have 2 segment divs
    const segmentMatches = html.match(/<div[^>]*style="[^"]*height:\s*7px/g)
    expect(segmentMatches).toHaveLength(2)
    // Should contain router role colours (from markerColorsForRole)
    expect(html).toContain('background')
  })

  test('test_pillHtml_segmentsHaveLvSegClassAndDataRouter', () => {
    const pill: SitePill = {
      site: SITES[0]!,
      routers: [
        mkNode('AMS1-core-01', 'AMS1', 16001),
        mkNode('AMS1-core-02', 'AMS1', 16002),
      ],
    }
    const html = pillHtml(pill)
    // Each segment should have class="lv-seg" and data-router
    expect(html).toContain('class="lv-seg"')
    expect(html).toContain('data-router="AMS1-core-01"')
    expect(html).toContain('data-router="AMS1-core-02"')
  })

  test('test_pillHtml_pillHasDataSite', () => {
    const pill: SitePill = {
      site: SITES[0]!,
      routers: [mkNode('AMS1-core-01', 'AMS1', 16001)],
    }
    const html = pillHtml(pill)
    // Pill container should have data-site attribute
    expect(html).toContain('data-site="AMS1"')
  })

  test('test_pillHtml_accessibleNameWithAriaLabel', () => {
    const pill: SitePill = {
      site: SITES[0]!,
      routers: [
        mkNode('AMS1-core-01', 'AMS1', 16001),
        mkNode('AMS1-core-02', 'AMS1', 16002),
      ],
    }
    const html = pillHtml(pill)
    // Pill has aria-label (role/tabindex come from Leaflet marker, not inner HTML)
    expect(html).toMatch(/aria-label="AMS1\s*[—–-]\s*core-01,\s*core-02"/)
    // No nested focusable element (W9: Leaflet marker is the focusable element)
    expect(html).not.toContain('role="button"')
    expect(html).not.toContain('tabindex="0"')
  })

  test('test_pillHtml_plainPill_roleColouredDot', () => {
    // Plain pill (no routers) renders as a single role-coloured dot
    const pill: SitePill = {
      site: SITES[0]!, // 'compute' role
      routers: [],
    }
    const html = pillHtml(pill)
    // Should have data-site and aria-label (site name only)
    expect(html).toContain('data-site="AMS1"')
    expect(html).toContain('aria-label="AMS1"')
    // Should have a single lv-seg (the dot)
    expect(html).toContain('class="lv-seg"')
    // Should be a circle (border-radius:50%)
    expect(html).toContain('border-radius:50%')
    // Should not have data-router (no routers)
    expect(html).not.toContain('data-router')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// escapeHtml tests
// ─────────────────────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  test('test_escapeHtml_specialChars_escaped', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  test('test_escapeHtml_normalText_unchanged', () => {
    expect(escapeHtml('AMS1-core-01')).toBe('AMS1-core-01')
  })

  test('test_escapeHtml_xssPayload_neutralized', () => {
    const hostile = '"><img src=x onerror=alert(1)>'
    const escaped = escapeHtml(hostile)
    // Should not contain unescaped angle brackets or quotes
    expect(escaped).not.toContain('<')
    expect(escaped).not.toContain('>')
    expect(escaped).not.toContain('"')
    expect(escaped).toBe('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;')
  })
})

describe('pillHtml hostile names', () => {
  test('test_pillHtml_hostileSiteName_escapedInHtml', () => {
    const hostileSite = site('"><script>alert(1)</script>', 52.37, 4.89)
    const pill: SitePill = {
      site: hostileSite,
      routers: [],
    }
    const html = pillHtml(pill)
    // The hostile name should be escaped, not raw
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  test('test_pillHtml_hostileRouterName_escapedInHtml', () => {
    const pill: SitePill = {
      site: SITES[0]!,
      routers: [
        { ...mkNode('AMS1-"><img', 'AMS1', 16001), name: '"><img src=x onerror=alert(1)>' },
      ],
    }
    const html = pillHtml(pill)
    // The hostile router name should be escaped
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// pillObstacles tests
// ─────────────────────────────────────────────────────────────────────────────

describe('pillObstacles', () => {
  test('test_pillObstacles_belowLabelZoom_pillBoxOnly', () => {
    const pill: SitePill = {
      site: SITES[0]!,
      routers: [mkNode('AMS1-core-01', 'AMS1', 16001)],
    }
    const pills = new Map([['AMS1', pill]])
    const obstacles = pillObstacles(pills, LABEL_ZOOM - 1, true)
    // Only pill box
    expect(obstacles).toHaveLength(1)
    // Centre is at the site
    expect(obstacles[0]!.at[0]).toBeCloseTo(52.37, 9)
    expect(obstacles[0]!.at[1]).toBeCloseTo(4.89, 9)
  })

  test('test_pillObstacles_atLabelZoom_addsLabelBlockRightOfPill', () => {
    const pill: SitePill = {
      site: SITES[0]!,
      routers: [mkNode('AMS1-core-01', 'AMS1', 16001)],
    }
    const pills = new Map([['AMS1', pill]])
    const obstacles = pillObstacles(pills, LABEL_ZOOM, true)
    // Pill box + label box
    expect(obstacles).toHaveLength(2)
    // Label box is to the right (positive dx)
    const labelBox = obstacles.find((o) => o.dx > 0)
    expect(labelBox).toBeDefined()
  })
})
