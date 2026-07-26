/**
 * Open-Meteo client.
 *
 * Open-Meteo is the *only* source of weather data in this app. The Windy panel
 * is a visual radar loop and nothing is ever read out of it.
 *
 * Note on resolution: we deliberately do not request `minutely_15`. Open-Meteo
 * only has genuinely high-resolution sub-hourly models for Central Europe and
 * North America; for Singapore those fields are just interpolated from the
 * hourly data, so they'd imply a precision the underlying model doesn't have.
 * Everything here is driven by hourly values.
 */

import type { Coords } from "./geo";

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

const CURRENT_FIELDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "precipitation",
  "rain",
  "showers",
  "weather_code",
  "wind_speed_10m",
  "cloud_cover",
].join(",");

const HOURLY_FIELDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "precipitation_probability",
  "precipitation",
  "rain",
  "showers",
  "wind_speed_10m",
  "cloud_cover",
  "uv_index",
].join(",");

export type OpenMeteoForecast = {
  latitude: number;
  longitude: number;
  timezone: string;
  current: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    precipitation: number;
    rain: number;
    showers: number;
    weather_code: number;
    wind_speed_10m: number;
    cloud_cover: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    relative_humidity_2m: number[];
    precipitation_probability: (number | null)[];
    precipitation: number[];
    rain: number[];
    showers: number[];
    wind_speed_10m: number[];
    cloud_cover: number[];
    uv_index: number[];
  };
};

export class OpenMeteoError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "OpenMeteoError";
  }
}

/**
 * Fetch the 2-day hourly forecast for a point.
 *
 * `revalidate` drives Next's data cache: forecast data updates on a roughly
 * hourly cadence upstream, so caching for 10 minutes keeps the UI snappy and
 * keeps us far below Open-Meteo's free-tier fair-use limits even if the map
 * pin gets dragged around a lot.
 */
export async function fetchForecast(
  { lat, lon }: Coords,
  { revalidate = 600 }: { revalidate?: number } = {}
): Promise<OpenMeteoForecast> {
  const url = new URL(FORECAST_ENDPOINT);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("timezone", "Asia/Singapore");
  url.searchParams.set("current", CURRENT_FIELDS);
  url.searchParams.set("hourly", HOURLY_FIELDS);
  url.searchParams.set("forecast_days", "2");

  const res = await fetch(url, {
    next: { revalidate },
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OpenMeteoError(
      `Open-Meteo returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      res.status
    );
  }

  const data = (await res.json()) as OpenMeteoForecast;
  if (!data?.hourly?.time?.length) {
    throw new OpenMeteoError("Open-Meteo response was missing hourly data");
  }
  return data;
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

export type GeocodeResult = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  admin1?: string;
};

type OpenMeteoGeocodeResponse = {
  results?: Array<{
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    country_code?: string;
    admin1?: string;
  }>;
};

/** Search Singapore place names. Returns [] for no matches rather than throwing. */
export async function geocode(query: string): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const url = new URL(GEOCODING_ENDPOINT);
  url.searchParams.set("name", trimmed);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  url.searchParams.set("countryCode", "SG");

  const res = await fetch(url, {
    next: { revalidate: 86400 }, // place names don't move
    headers: { Accept: "application/json" },
  });

  if (!res.ok) throw new OpenMeteoError(`Geocoding failed (${res.status})`, res.status);

  const data = (await res.json()) as OpenMeteoGeocodeResponse;
  return (data.results ?? [])
    .filter((r) => r.country_code === "SG" || r.country_code === undefined)
    .map((r) => ({
      id: r.id,
      name: r.name,
      lat: r.latitude,
      lon: r.longitude,
      admin1: r.admin1,
    }));
}

// ---------------------------------------------------------------------------
// WMO weather codes
// ---------------------------------------------------------------------------

export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "storm";

/**
 * WMO code → plain language + an icon kind. Only the codes that actually occur
 * in Singapore are spelled out; snow/ice codes collapse into sensible defaults
 * because they will never fire here.
 */
export function describeWeather(code: number): { label: string; kind: WeatherKind } {
  if (code === 0) return { label: "Clear sky", kind: "clear" };
  if (code === 1) return { label: "Mainly clear", kind: "clear" };
  if (code === 2) return { label: "Partly cloudy", kind: "partly" };
  if (code === 3) return { label: "Overcast", kind: "cloudy" };
  if (code === 45 || code === 48) return { label: "Fog", kind: "fog" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", kind: "drizzle" };
  if (code === 61) return { label: "Light rain", kind: "rain" };
  if (code === 63) return { label: "Moderate rain", kind: "rain" };
  if (code === 65) return { label: "Heavy rain", kind: "rain" };
  if (code === 66 || code === 67) return { label: "Freezing rain", kind: "rain" };
  if (code === 80) return { label: "Light showers", kind: "rain" };
  if (code === 81) return { label: "Moderate showers", kind: "rain" };
  if (code === 82) return { label: "Violent showers", kind: "storm" };
  if (code === 95) return { label: "Thunderstorm", kind: "storm" };
  if (code === 96 || code === 99) return { label: "Thunderstorm with hail", kind: "storm" };
  if (code >= 71 && code <= 77) return { label: "Snow", kind: "cloudy" };
  if (code === 85 || code === 86) return { label: "Snow showers", kind: "cloudy" };
  return { label: "Unknown", kind: "cloudy" };
}

/** Is it raining *right now* at this point, per the current-conditions block. */
export function isRainingNow(current: OpenMeteoForecast["current"]): boolean {
  return current.precipitation > 0 || current.rain > 0 || current.showers > 0;
}
