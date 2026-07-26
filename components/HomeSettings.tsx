"use client";

import { useEffect, useState } from "react";
import type { Coords } from "@/lib/geo";
import { LAUNDRY_CONFIG } from "@/lib/laundryLogic";
import {
  checkPushSupport,
  getExistingSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/pushClient";
import type { HomeLocation } from "@/lib/store";
import { Card } from "./ui";

function formatCoords({ lat, lon }: Coords): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function sameSpot(a: Coords, b: Coords): boolean {
  // ~11m tolerance — matches the rounding applied before storage.
  return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;
}

export function HomeSettings({
  coords,
  placeLabel,
  home,
  storeConfigured,
  onHomeChange,
  onGoHome,
}: {
  coords: Coords;
  placeLabel: string;
  home: HomeLocation | null;
  storeConfigured: boolean;
  onHomeChange: (home: HomeLocation | null) => void;
  onGoHome: () => void;
}) {
  const [savingHome, setSavingHome] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [support, setSupport] = useState<ReturnType<typeof checkPushSupport> | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Reflect the *actual* browser subscription state on mount, rather than
  // trusting local state — the user may have revoked permission in settings, or
  // be on a different device from the one that subscribed.
  useEffect(() => {
    const result = checkPushSupport();
    setSupport(result);
    if (!result.supported) return;

    getExistingSubscription()
      .then((sub) => setPushEnabled(Boolean(sub) && Notification.permission === "granted"))
      .catch(() => setPushEnabled(false));
  }, []);

  const isHome = home ? sameSpot(coords, home) : false;

  async function saveHome() {
    setSavingHome(true);
    setMessage(null);
    try {
      const res = await fetch("/api/home", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: coords.lat, lon: coords.lon, label: placeLabel }),
      });
      const data = (await res.json()) as { home?: HomeLocation; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      onHomeChange(data.home ?? null);
      setMessage("Home location saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save home location.");
    } finally {
      setSavingHome(false);
    }
  }

  async function togglePush() {
    setPushBusy(true);
    setPushError(null);
    try {
      if (pushEnabled) {
        await unsubscribeFromPush();
        setPushEnabled(false);
        setMessage("Rain alerts turned off.");
      } else {
        // Subscribing also adopts the current pin as home if none is set yet,
        // so enabling alerts on a fresh install does the right thing.
        const target = home ?? coords;
        await subscribeToPush(target, home ? undefined : placeLabel);
        setPushEnabled(true);
        if (!home) {
          const res = await fetch("/api/home");
          const data = (await res.json()) as { home?: HomeLocation };
          onHomeChange(data.home ?? null);
        }
        setMessage("Rain alerts on. You'll be notified before rain reaches home.");
      }
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPushBusy(false);
    }
  }

  const n = LAUNDRY_CONFIG.notification;
  const canPush = support?.supported === true && storeConfigured;

  return (
    <Card title="Home & notifications">
      {/* ---- Home location ---- */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Home location
            </p>
            {home ? (
              <>
                <p className="mt-1 truncate text-sm font-medium text-slate-100">
                  {home.label ?? "Saved pin"}
                </p>
                <p className="text-xs tabular-nums text-slate-500">{formatCoords(home)}</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-400">Not set yet.</p>
            )}
          </div>

          {home && !isHome && (
            <button
              type="button"
              onClick={onGoHome}
              className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/[0.12]"
            >
              Go to home
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={saveHome}
          disabled={savingHome || isHome || !storeConfigured}
          className="mt-3 w-full rounded-lg bg-sky-500/90 px-4 py-2.5 text-sm font-semibold text-[#04121f] transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-slate-500"
        >
          {isHome
            ? "This pin is your home"
            : savingHome
              ? "Saving…"
              : "Set this pin as my home"}
        </button>

        {!storeConfigured && (
          <p className="mt-2 text-[11px] leading-relaxed text-amber-400/80">
            Storage isn&apos;t configured — add the Upstash env vars to save a home
            location and enable alerts.
          </p>
        )}
      </div>

      {/* ---- Push notifications ---- */}
      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Rain alerts
            </p>
            <p className="mt-1 text-sm text-slate-300">
              Push me when rain is likely near home
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              Fires at {n.precipProbThresholdPct}%+ chance within {n.lookaheadHours}h · at most
              once every {n.cooldownMinutes} min
              {n.quietHours.enabled &&
                ` · only ${n.quietHours.startHour}:00–${n.quietHours.endHour}:00`}
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={pushEnabled}
            aria-label="Enable rain alerts"
            onClick={togglePush}
            disabled={pushBusy || !canPush}
            className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
              pushEnabled ? "bg-emerald-400" : "bg-white/15"
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                pushEnabled ? "left-6" : "left-1"
              } ${pushBusy ? "animate-pulse" : ""}`}
            />
          </button>
        </div>

        {support && !support.supported && (
          <p className="mt-2 text-[11px] leading-relaxed text-amber-400/80">{support.reason}</p>
        )}
        {pushError && (
          <p className="mt-2 text-[11px] leading-relaxed text-rose-400">{pushError}</p>
        )}
        {pushEnabled && !home && (
          <p className="mt-2 text-[11px] leading-relaxed text-amber-400/80">
            Alerts are on, but no home location is set — save one above so the checker
            knows where to watch.
          </p>
        )}
      </div>

      {message && (
        <p aria-live="polite" className="mt-3 text-center text-xs text-slate-400">
          {message}
        </p>
      )}
    </Card>
  );
}
