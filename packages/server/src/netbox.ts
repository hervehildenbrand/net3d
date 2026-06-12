export interface NetBoxSite {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  region: string | null
  status: string
}

export interface NetBoxClient {
  getSites(): Promise<NetBoxSite[]>
}

// NetBox 3.7: *_list takes no pagination args and returns all rows.
const SITES_QUERY = `{
  site_list {
    id
    name
    latitude
    longitude
    status
    region { name }
  }
}`

interface RawSite {
  id: string
  name: string
  latitude: string | number | null
  longitude: string | number | null
  status: string
  region: { name: string } | null
}

export function createNetBoxClient(baseUrl: string, token: string): NetBoxClient {
  async function graphql<T>(query: string): Promise<T> {
    const res = await fetch(`${baseUrl}/graphql/`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query }),
    })
    if (!res.ok) throw new Error(`NetBox GraphQL HTTP ${res.status}`)
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] }
    if (body.errors?.length) throw new Error(`NetBox GraphQL: ${body.errors[0]?.message}`)
    if (!body.data) throw new Error('NetBox GraphQL: empty response')
    return body.data
  }

  return {
    async getSites() {
      const data = await graphql<{ site_list: RawSite[] }>(SITES_QUERY)
      return data.site_list.map((s) => ({
        id: s.id,
        name: s.name,
        // NetBox returns decimals as strings
        latitude: s.latitude === null ? null : Number(s.latitude),
        longitude: s.longitude === null ? null : Number(s.longitude),
        region: s.region?.name ?? null,
        status: s.status,
      }))
    },
  }
}
