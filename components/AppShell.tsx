"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConditionsPanel } from "@/components/ConditionsPanel";
import { HomeSettings } from "@/components/HomeSettings";
import { LaundryAdvisor } from "@/components/LaundryAdvisor";
import { RainTimeline } from "@/components/RainTimeline";
import { SearchBox } from "@/components/SearchBox";
import { WindyRadar } from "@/components/WindyRadar";
import type { ForecastView } from "@/lib/forecast";
import { SG_CENTER, roundCoords, type Coords } from "@/lib/geo";
import type { HomeLocation } from "@/lib/store";

/**
 * Leaflet touches `window` at module scope, so the map must never be part of
 * the server render. `ssr: false` keeps it out of the SSR pass entirely.
 */
const MapLocator = dynamic(() => import("@/components/MapLocator"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#0d1526] text-sm text-slate-500">
      Loading map…
    </div>
  ),
});

const LAST_PIN_KEY = "sg-laundry:last-pin";
/** Re-fetch the forecast on this cadence while the tab is open. */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export function AppShell() {
  const [coords, setCoords] = useState<Coords>(SG_CENTER);
  const [placeLabel, setPlaceLabel] = useState("Central Singapore");
  const [focusToken, setFocusToken] = useState(0);

  const [forecast, setForecast] = useState<ForecastView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [home, setHome] = useState<HomeLocation | null>(null);
  const [storeConfigured, setStoreConfigured] = useState(false);

  /** Incremented to force a re-fetch without changing the coordinates. */
  const [refreshTick, setRefreshTick] = useState(0);

  // Tracks whether the user has already moved the pin, so async startup work
  // (loading the saved home) can't yank the map out from under them.
  const userHasChosen = useRef(false);

  // ---- Startup: restore the last pin, then the saved home ------------------
  useEffect(() => {
    let restoredLocally = false;
    try {
      const stored = localStorage.getItem(LAST_PIN_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { lat: number; lon: number; label?: string };
        if (Number.isFinite(parsed.lat) && Number.isFinite(parsed.lon)) {
          setCoords({ lat: parsed.lat, lon: parsed.lon });
          if (parsed.label) setPlaceLabel(parsed.label);
          setFocusToken((t) => t + 1);
          restoredLocally = true;
        }
      }
    } catch {
      // Private browsing or a corrupt value — not worth surfacing.
    }

    let cancelled = false;
    fetch("/api/home")
      .then((res) => res.json())
      .then((data: { home: HomeLocation | null; configured: boolean }) => {
        if (cancelled) return;
        setHome(data.home);
        setStoreConfigured(data.configured);
        // Only jump to home if we have nothing better to show.
        if (data.home && !restoredLocally && !userHasChosen.current) {
          setCoords({ lat: data.home.lat, lon: data.home.lon });
          setPlaceLabel(data.home.label ?? "Home");
          setFocusToken((t) => t + 1);
        }
      })
      .catch(() => {
        /* Storage unavailable — the app still works as a pure locator. */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Persist the pin locally (never leaves the device) -------------------
  useEffect(() => {
    try {
      localStorage.setItem(LAST_PIN_KEY, JSON.stringify({ ...coords, label: placeLabel }));
    } catch {
      /* ignore */
    }
  }, [coords, placeLabel]);

  // ---- Forecast fetching --------------------------------------------------
  // Debounced so dragging the pin across the island fires one request, not
  // sixty; aborted on change so a slow earlier response can't overwrite a
  // newer one.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/weather?lat=${coords.lat}&lon=${coords.lon}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load the forecast.");
        setForecast(data as ForecastView);
        setError(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load the forecast.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [coords, refreshTick]);

  // ---- Periodic refresh ---------------------------------------------------
  useEffect(() => {
    const interval = setInterval(
      () => setRefreshTick((t) => t + 1),
      REFRESH_INTERVAL_MS
    );
    // Also refresh when the tab comes back to the foreground — a forecast from
    // three hours ago is exactly when you'd most want fresh data.
    const onVisible = () => {
      if (document.visibilityState === "visible") setRefreshTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // ---- Handlers -----------------------------------------------------------
  const handleMapSelect = useCallback((next: Coords) => {
    userHasChosen.current = true;
    setCoords(next);
    setPlaceLabel(`Dropped pin · ${next.lat.toFixed(4)}, ${next.lon.toFixed(4)}`);
  }, []);

  const handleSearchSelect = useCallback((next: Coords, label: string) => {
    userHasChosen.current = true;
    setCoords(roundCoords(next));
    setPlaceLabel(label);
    setFocusToken((t) => t + 1);
  }, []);

  const handleGoHome = useCallback(() => {
    if (!home) return;
    userHasChosen.current = true;
    setCoords({ lat: home.lat, lon: home.lon });
    setPlaceLabel(home.label ?? "Home");
    setFocusToken((t) => t + 1);
  }, [home]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-5 sm:px-5">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Will it dry?
        </h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Singapore rain &amp; laundry advisor
        </p>
      </header>

      <div className="mb-4">
        <SearchBox onSelect={handleSearchSelect} />
      </div>

      <div className="mb-4 h-[300px] overflow-hidden rounded-2xl border border-white/10 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.6)] sm:h-[380px]">
        <MapLocator
          coords={coords}
          home={home}
          focusToken={focusToken}
          onSelect={handleMapSelect}
        />
      </div>

      <p className="mb-4 text-center text-[11px] text-slate-500">
        Tap the map or drag the pin · showing{" "}
        <span className="tabular-nums text-slate-400">
          {coords.lat.toFixed(4)}, {coords.lon.toFixed(4)}
        </span>
      </p>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {error}
        </div>
      )}

      <div className="space-y-4">
        <LaundryAdvisor forecast={forecast} />
        <ConditionsPanel forecast={forecast} loading={loading} placeLabel={placeLabel} />
        <RainTimeline forecast={forecast} />
        <WindyRadar coords={coords} />
        <HomeSettings
          coords={coords}
          placeLabel={placeLabel}
          home={home}
          storeConfigured={storeConfigured}
          onHomeChange={setHome}
          onGoHome={handleGoHome}
        />
      </div>

      <footer className="mt-8 space-y-1 text-center text-[11px] leading-relaxed text-slate-600">
        <p>
          Weather data from{" "}
          <a
            href="https://open-meteo.com/"
            className="underline underline-offset-2 hover:text-slate-400"
            target="_blank"
            rel="noreferrer noopener"
          >
            Open-Meteo
          </a>{" "}
          · radar from Windy · map tiles © OpenStreetMap contributors, © CARTO
        </p>
        <p>No accounts, no analytics, no tracking.</p>
      </footer>
    </main>
  );
}
