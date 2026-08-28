/**
 * CARTO raster basemap URL. Keyless requests still work but every tile is
 * watermarked "API KEY REQUIRED" — get a free key at
 * https://carto.com/basemaps/apikey and set VITE_CARTO_KEY in the root .env.
 */
export function cartoTileUrl(key: string | undefined): string {
  const base = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
  return key ? `${base}?key=${key}` : base
}
