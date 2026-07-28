"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  SG_LEAFLET_BOUNDS,
  clampToSingapore,
  roundCoords,
  type Coords,
} from "@/lib/geo";

/**
 * CARTO basemap style.
 *
 * All three are the same free, key-less CARTO raster service — only the palette
 * differs. Dark Matter is the default because the app itself is a dark night-sky
 * theme and a light map would sit in it like a lightbox. Swap to
 * "voyager" (colourful, most labels) or "light_all" (Positron) if you prefer.
 */
const BASEMAP_STYLE = "dark_all"; // "voyager" | "light_all" (Positron) | "dark_all"

const TILE_URL = `https://{s}.basemaps.cartocdn.com/rastertiles/${BASEMAP_STYLE}/{z}/{x}/{y}{r}.png`;

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Leaflet's default marker points at PNGs via a relative URL that bundlers
 * rewrite incorrectly, which is why every Leaflet+webpack project has a
 * broken-image marker at some point. Using a divIcon with inline SVG sidesteps
 * the asset pipeline entirely — nothing to resolve, nothing to 404.
 */
const pinIcon = L.divIcon({
  className: "",
  iconSize: [30, 42],
  iconAnchor: [15, 40],
  html: `
    <svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 41C15 41 28 25.5 28 15A13 13 0 1 0 2 15c0 10.5 13 26 13 26z"
            fill="#38bdf8" stroke="#0b1220" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="15" cy="15" r="5" fill="#0b1220"/>
    </svg>`,
});

/** Translates map clicks into a clamped, rounded selection. */
function ClickHandler({ onSelect }: { onSelect: (c: Coords) => void }) {
  useMapEvents({
    click(event) {
      onSelect(roundCoords(clampToSingapore({ lat: event.latlng.lat, lon: event.latlng.lng })));
    },
  });
  return null;
}

/**
 * Programmatic recentering.
 *
 * Keyed on `focusToken` rather than on the coordinates themselves: if we panned
 * whenever `coords` changed, dragging the pin would make the map chase it and
 * fight the user's finger. The token only increments for *external* changes
 * (a search result chosen, the last pin restored on load), which are exactly
 * the cases where recentering is wanted.
 */
function Recenter({ coords, focusToken }: { coords: Coords; focusToken: number }) {
  const map = useMap();
  const lastToken = useRef(focusToken);

  useEffect(() => {
    if (lastToken.current === focusToken) return;
    lastToken.current = focusToken;
    map.flyTo([coords.lat, coords.lon], Math.max(map.getZoom(), 13), {
      duration: 0.6,
    });
  }, [coords, focusToken, map]);

  return null;
}

/**
 * Leaflet measures its container on mount. Inside a flex/grid layout that is
 * still settling — or when the map starts hidden — it can latch onto a zero or
 * stale size and render grey tiles. Observing the container and calling
 * invalidateSize() is the standard fix.
 */
function ResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    // One deferred pass for the initial layout.
    const timer = setTimeout(() => map.invalidateSize(), 200);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [map]);

  return null;
}

export type MapLocatorProps = {
  coords: Coords;
  focusToken: number;
  onSelect: (coords: Coords) => void;
};

export default function MapLocator({ coords, focusToken, onSelect }: MapLocatorProps) {
  const markerHandlers = useMemo(
    () => ({
      dragend(event: L.DragEndEvent) {
        const { lat, lng } = (event.target as L.Marker).getLatLng();
        onSelect(roundCoords(clampToSingapore({ lat, lon: lng })));
      },
    }),
    [onSelect]
  );

  return (
    <MapContainer
      center={[coords.lat, coords.lon]}
      zoom={12}
      minZoom={11}
      maxZoom={17}
      // Hard-locks panning to Singapore. Viscosity 1.0 makes the edge
      // completely solid rather than rubber-banding.
      maxBounds={SG_LEAFLET_BOUNDS}
      maxBoundsViscosity={1.0}
      scrollWheelZoom
      className="h-full w-full"
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={17} />

      <ClickHandler onSelect={onSelect} />
      <Recenter coords={coords} focusToken={focusToken} />
      <ResizeHandler />

      <Marker
        position={[coords.lat, coords.lon]}
        icon={pinIcon}
        draggable
        eventHandlers={markerHandlers}
        autoPan
      />
    </MapContainer>
  );
}
