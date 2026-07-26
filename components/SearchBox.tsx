"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Coords } from "@/lib/geo";
import type { GeocodeResult } from "@/lib/weather";

/**
 * Place search over Open-Meteo's geocoding API (proxied through /api/geocode).
 *
 * Debounced at 300ms and guarded with an AbortController: without the abort, a
 * slow response for "tamp" can land after the response for "tampines" and
 * repopulate the list with stale results.
 */
export function SearchBox({ onSelect }: { onSelect: (coords: Coords, label: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { results?: GeocodeResult[] };
        setResults(data.results ?? []);
        setActiveIndex(-1);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Dismiss the dropdown on an outside tap (important on mobile, where there's
  // no blur event from tapping the map).
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function choose(result: GeocodeResult) {
    onSelect({ lat: result.lat, lon: result.lon }, result.name);
    setQuery(result.name);
    setOpen(false);
    setResults([]);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[activeIndex >= 0 ? activeIndex : 0]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search Singapore — e.g. Tampines, Clementi"
          aria-label="Search for a place in Singapore"
          aria-expanded={open}
          aria-controls={listId}
          autoComplete="off"
          className="w-full rounded-xl border border-white/10 bg-white/[0.06] py-3 pl-10 pr-10 text-[15px] text-slate-100 placeholder:text-slate-500 outline-none backdrop-blur-sm transition focus:border-sky-400/50 focus:bg-white/[0.09] focus:ring-2 focus:ring-sky-400/20"
        />

        {loading && (
          <span
            className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400"
            aria-hidden
          />
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-[1000] mt-2 max-h-64 w-full overflow-auto rounded-xl border border-white/10 bg-[#0f1a2e]/95 py-1 shadow-2xl backdrop-blur-md"
        >
          {results.map((result, i) => (
            <li key={result.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                onClick={() => choose(result)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex w-full items-baseline gap-2 px-4 py-2.5 text-left text-[15px] transition ${
                  i === activeIndex ? "bg-sky-400/15 text-white" : "text-slate-200"
                }`}
              >
                <span className="font-medium">{result.name}</span>
                {result.admin1 && (
                  <span className="text-xs text-slate-500">{result.admin1}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !loading && query.trim().length >= 2 && results.length === 0 && (
        <div className="absolute z-[1000] mt-2 w-full rounded-xl border border-white/10 bg-[#0f1a2e]/95 px-4 py-3 text-sm text-slate-400 backdrop-blur-md">
          No Singapore places match “{query.trim()}”. Try tapping the map instead.
        </div>
      )}
    </div>
  );
}
