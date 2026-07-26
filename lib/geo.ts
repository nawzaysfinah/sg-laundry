/**
 * Singapore geography constraints.
 *
 * Everything in this app is locked to Singapore. This module is the single
 * source of truth for "where is allowed" — the map, the geocoder and every API
 * route validate against it, so a bad/hostile lat-lon can never reach
 * Open-Meteo or get persisted as a home location.
 */

/**
 * Padded Singapore bounding box.
 *
 * The base box (lat 1.15–1.47, lon 103.60–104.05) is padded outward so the
 * outlying bits are comfortably inside rather than sitting exactly on an edge:
 *   - Tuas / Tuas Link      ~1.32, 103.63  (west)
 *   - Sentosa / Pulau Bukom ~1.25, 103.82  (south)
 *   - Pulau Ubin            ~1.41, 103.96  (north-east)
 *   - Pedra Branca is deliberately excluded — it's 40km east and would make the
 *     default map view useless.
 */
export const SG_BOUNDS = {
  minLat: 1.13,
  maxLat: 1.49,
  minLon: 103.55,
  maxLon: 104.12,
} as const;

/** Roughly the geographic centre of the main island (near Bukit Timah). */
export const SG_CENTER = { lat: 1.3521, lon: 103.8198 } as const;

/** Leaflet-shaped bounds: [[south, west], [north, east]]. */
export const SG_LEAFLET_BOUNDS: [[number, number], [number, number]] = [
  [SG_BOUNDS.minLat, SG_BOUNDS.minLon],
  [SG_BOUNDS.maxLat, SG_BOUNDS.maxLon],
];

export type Coords = { lat: number; lon: number };

export function isInSingapore({ lat, lon }: Coords): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= SG_BOUNDS.minLat &&
    lat <= SG_BOUNDS.maxLat &&
    lon >= SG_BOUNDS.minLon &&
    lon <= SG_BOUNDS.maxLon
  );
}

/** Pull an out-of-range point back to the nearest in-range point. */
export function clampToSingapore({ lat, lon }: Coords): Coords {
  return {
    lat: Math.min(Math.max(lat, SG_BOUNDS.minLat), SG_BOUNDS.maxLat),
    lon: Math.min(Math.max(lon, SG_BOUNDS.minLon), SG_BOUNDS.maxLon),
  };
}

/**
 * Round coordinates to ~11m precision before they leave the browser or get
 * stored. Open-Meteo resolves to a ~1km grid cell anyway, so extra decimals buy
 * no accuracy and only make the stored location more personally identifying
 * than it needs to be.
 */
export function roundCoords({ lat, lon }: Coords): Coords {
  return {
    lat: Math.round(lat * 1e4) / 1e4,
    lon: Math.round(lon * 1e4) / 1e4,
  };
}

/**
 * Parse and validate a lat/lon pair coming from an untrusted source
 * (query string, request body). Returns null rather than throwing.
 */
export function parseCoords(
  lat: unknown,
  lon: unknown
): Coords | null {
  const parsedLat = typeof lat === "number" ? lat : Number.parseFloat(String(lat));
  const parsedLon = typeof lon === "number" ? lon : Number.parseFloat(String(lon));
  const coords = { lat: parsedLat, lon: parsedLon };
  if (!isInSingapore(coords)) return null;
  return roundCoords(coords);
}
