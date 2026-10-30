import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  RELEASES,
  REGION_LABEL,
  WEEKDAYS,
  WEEKS,
  isSouth,
  type Region,
  type Release,
} from "@/data/releases";
import { getCatalogue, type CatalogueResult } from "@/lib/catalogue";
import { getLiveRatings, type LiveRatings } from "@/lib/ratings";

export const Route = createFileRoute("/")({ component: Home });

/** No usable poster found. Don't request a missing file. */
const MISSING = new Set(["big-girls"]);

const WATCHLIST_STORAGE_KEY = "ott-digest:watchlist:v1";
const COUNTRY_STORAGE_KEY = "ott-digest:country:v1";

const COUNTRIES: { code: string; label: string }[] = [
  { code: "AU", label: "Australia" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "IN", label: "India" },
  { code: "CA", label: "Canada" },
  { code: "NZ", label: "New Zealand" },
  { code: "IE", label: "Ireland" },
  { code: "SG", label: "Singapore" },
  { code: "AE", label: "UAE" },
];

type ShelfName = "show" | "tv" | "cinema";
type RegionFilter =
  | "english"
  | "british"
  | "hindi"
  | "south"
  | "tamil"
  | "telugu"
  | "malayalam"
  | "kannada";

type SortMode = "title" | "rating";

function dayKey(item: Release) {
  return `${item.week}-${item.weekday}`;
}

function shortDate(day: string, weekday: number) {
  const [n, month] = day.split(" ");
  return `${WEEKDAYS[weekday].slice(0, 3)} ${n} ${(month ?? "").slice(0, 3)}`;
}

function imdbId(item: Release) {
  return item.imdb?.match(/tt\d+/)?.[0];
}

function visitorTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const ZONE_COUNTRY: Record<string, string> = {
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
  "Australia/Brisbane": "AU",
  "Australia/Perth": "AU",
  "Australia/Adelaide": "AU",
  "Australia/Hobart": "AU",
  "Australia/Darwin": "AU",
  "Australia/Lord_Howe": "AU",
  "Pacific/Auckland": "NZ",
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Europe/Paris": "FR",
  "Europe/Berlin": "DE",
  "Europe/Madrid": "ES",
  "Europe/Rome": "IT",
  "Europe/Amsterdam": "NL",
  "Europe/Brussels": "BE",
  "Europe/Stockholm": "SE",
  "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK",
  "Europe/Helsinki": "FI",
  "Europe/Warsaw": "PL",
  "Europe/Lisbon": "PT",
  "Europe/Athens": "GR",
  "Europe/Vienna": "AT",
  "Europe/Zurich": "CH",
  "Europe/Prague": "CZ",
  "Europe/Budapest": "HU",
  "Europe/Bucharest": "RO",
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR",
  "Asia/Shanghai": "CN",
  "Asia/Hong_Kong": "HK",
  "Asia/Singapore": "SG",
  "Asia/Dubai": "AE",
  "Asia/Bangkok": "TH",
  "Asia/Jakarta": "ID",
  "Asia/Manila": "PH",
  "Asia/Karachi": "PK",
  "Asia/Dhaka": "BD",
  "Asia/Colombo": "LK",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "America/Phoenix": "US",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "America/Mexico_City": "MX",
  "America/Sao_Paulo": "BR",
  "America/Argentina/Buenos_Aires": "AR",
  "Africa/Johannesburg": "ZA",
  "Africa/Lagos": "NG",
  "Africa/Cairo": "EG",
};

function countryFromLocale() {
  try {
    const tag = navigator.languages?.[0] || navigator.language || "";
    const region = tag.split("-")[1];
    return region && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : "";
  } catch {
    return "";
  }
}

function countryFromTimeZone(timeZone: string) {
  if (ZONE_COUNTRY[timeZone]) return ZONE_COUNTRY[timeZone];
  if (timeZone.startsWith("Australia/")) return "AU";
  if (timeZone.startsWith("Pacific/Auckland")) return "NZ";
  return "";
}

async function detectCountry(timeZone: string) {
  try {
    const saved = window.localStorage.getItem(COUNTRY_STORAGE_KEY);
    if (saved && /^[A-Z]{2}$/.test(saved)) return saved;
  } catch {
    // Ignore storage read errors
  }
  try {
    const response = await fetch("https://get.geojs.io/v1/ip/country.json", {
      signal: AbortSignal.timeout(2500),
    });
    if (response.ok) {
      const data = (await response.json()) as { country?: string };
      if (data.country && /^[A-Z]{2}$/.test(data.country)) return data.country;
    }
  } catch {
    // IP lookup is a best effort. Time zone and language still give a country.
  }
  return countryFromLocale() || countryFromTimeZone(timeZone) || "US";
}

function matchesShelf(item: Release, shelf: ShelfName) {
  if (shelf === "show") return item.kind === "series";
  if (shelf === "cinema") return item.kind === "movie" && item.place === "cinema";
  return item.kind === "movie" && item.place === "streaming";
}

function matchesRegionFilter(item: Release, filter: RegionFilter) {
  if (filter === "south") return isSouth(item.region);
  return item.region === filter;
}

function normalizePlatformGroup(platform: string): string {
  const lower = platform.toLowerCase();
  if (lower.includes("netflix")) return "Netflix";
  if (lower.includes("prime video") || lower.includes("amazon")) return "Prime Video";
  if (lower.includes("apple tv")) return "Apple TV";
  if (lower.includes("hotstar") || lower.includes("jio")) return "JioHotstar";
  if (lower.includes("zee5")) return "ZEE5";
  if (lower.includes("cinema") || lower.includes("theat")) return "Cinemas";
  if (lower.includes("disney+") || lower.includes("hulu")) return "Disney+ / Hulu";
  if (lower.includes("hbo") || lower.includes("max") || lower.includes("sky")) return "HBO / Sky";
  if (lower.includes("paramount") || lower.includes("cbs")) return "Paramount+ / CBS";
  if (lower.includes("peacock") || lower.includes("nbc")) return "Peacock / NBC";
  if (lower.includes("bbc") || lower.includes("iplayer") || lower.includes("itv") || lower.includes("channel 4")) {
    return "UK TV (BBC / ITV / C4)";
  }
  if (lower.includes("abc")) return "ABC";
  if (lower.includes("sonyliv")) return "SonyLIV";
  if (lower.includes("aha")) return "aha";
  return platform.split("·")[0].trim() || "Other";
}

function toggleValue<T>(list: T[], value: T) {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

function shelfLabel(item: Release) {
  if (item.kind === "series") return "Show";
  if (item.place === "cinema") return "Cinema";
  return "Movie on TV";
}

function loadWatchlist(): string[] {
  try {
    const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveWatchlist(ids: string[]) {
  try {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Ignore storage write errors
  }
}

function downloadIcsReminder(item: Release, rangeYear?: string) {
  const year = Number(rangeYear?.match(/\b(20\d{2})\b/)?.[1]) || new Date().getFullYear();
  const [dayStr, monthName] = item.day.split(" ");
  const monthIdx = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ].indexOf(monthName);
  const m = monthIdx >= 0 ? monthIdx + 1 : new Date().getMonth() + 1;
  const d = Number(dayStr) || 1;
  const dateStamp = `${year}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
  const summary = `${item.title} (${shelfLabel(item)} · ${item.platform})`;
  const desc = item.blurb.replace(/\r?\n/g, " ");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OTT Digest//Release Reminder//EN",
    "BEGIN:VEVENT",
    `UID:ott-digest-${item.id}-${dateStamp}`,
    `DTSTAMP:${dateStamp}T090000Z`,
    `DTSTART;VALUE=DATE:${dateStamp}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}${item.imdb ? ` — ${item.imdb}` : ""}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-release.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function Home() {
  const [pickedDays, setPickedDays] = useState<string[]>([]);
  const [pickedShelves, setPickedShelves] = useState<ShelfName[]>([]);
  const [pickedRegions, setPickedRegions] = useState<RegionFilter[]>([]);
  const [pickedPlatforms, setPickedPlatforms] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [onlySaved, setOnlySaved] = useState(false);
  const [onlyHighRated, setOnlyHighRated] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("title");

  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [pack, setPack] = useState<CatalogueResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [useSnapshotOverride, setUseSnapshotOverride] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [timeZone] = useState(visitorTimeZone);
  const [country, setCountry] = useState("");

  useEffect(() => {
    setWatchlist(loadWatchlist());
  }, []);

  const onToggleWatchlist = useCallback((id: string) => {
    setWatchlist((current) => {
      const next = toggleValue(current, id);
      saveWatchlist(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancel = false;
    detectCountry(timeZone).then((code) => {
      if (!cancel) setCountry(code);
    });
    return () => {
      cancel = true;
    };
  }, [timeZone]);

  const fetchLiveCatalogue = useCallback(
    (targetCountry: string, forceRefresh = false) => {
      if (!targetCountry) return () => {};
      let cancel = false;
      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setPack(null);
      }
      setFailed(false);
      setUseSnapshotOverride(false);

      getCatalogue({ data: { timeZone, country: targetCountry, forceRefresh } })
        .then((data) => {
          if (!cancel) {
            setPack(data);
            setRefreshing(false);
          }
        })
        .catch(() => {
          if (!cancel) {
            setFailed(true);
            setRefreshing(false);
          }
        });
      return () => {
        cancel = true;
      };
    },
    [timeZone],
  );

  useEffect(() => {
    if (!country) return;
    return fetchLiveCatalogue(country, false);
  }, [country, fetchLiveCatalogue]);

  const handleSelectCountry = useCallback((nextCode: string) => {
    setCountry(nextCode);
    try {
      window.localStorage.setItem(COUNTRY_STORAGE_KEY, nextCode);
    } catch {
      // Ignore storage write errors
    }
  }, []);

  const isSnapshot = failed || useSnapshotOverride;
  const releases = useMemo(
    () => pack?.releases ?? (isSnapshot ? RELEASES : []),
    [pack, isSnapshot],
  );
  const weekBands = pack?.weeks ?? WEEKS;
  const range = pack?.range ?? (isSnapshot ? "28 Sep – 11 Oct 2026" : "");
  const todayKey = pack?.todayKey ?? "";

  useEffect(() => {
    if (range) {
      document.title = `OTT digest · ${range}`;
    }
  }, [range]);

  const days = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const item of releases) {
      const key = dayKey(item);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { label: shortDate(item.day, item.weekday), count: 1 });
      }
    }
    return [...map.entries()].map(([key, val]) => ({
      key,
      label: val.label,
      count: val.count,
      isToday: key === todayKey,
    }));
  }, [releases, todayKey]);

  const availablePlatforms = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of releases) {
      const group = normalizePlatformGroup(item.platform);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }, [releases]);

  const availableRegions = useMemo(() => {
    const counts = new Map<Region, number>();
    for (const item of releases) {
      counts.set(item.region, (counts.get(item.region) ?? 0) + 1);
    }
    const chips: { key: RegionFilter; label: string; count: number }[] = [];
    const add = (key: RegionFilter, label: string, count: number) => {
      if (count > 0) chips.push({ key, label, count });
    };
    add("english", "English", counts.get("english") ?? 0);
    add("british", "British", counts.get("british") ?? 0);
    add("hindi", "Hindi", counts.get("hindi") ?? 0);
    const southCount =
      (counts.get("tamil") ?? 0) +
      (counts.get("telugu") ?? 0) +
      (counts.get("malayalam") ?? 0) +
      (counts.get("kannada") ?? 0);
    add("south", "South Indian", southCount);
    add("tamil", "Tamil", counts.get("tamil") ?? 0);
    add("telugu", "Telugu", counts.get("telugu") ?? 0);
    add("malayalam", "Malayalam", counts.get("malayalam") ?? 0);
    add("kannada", "Kannada", counts.get("kannada") ?? 0);
    return chips;
  }, [releases]);

  const shelfCounts = useMemo(() => {
    let show = 0;
    let tv = 0;
    let cinema = 0;
    for (const item of releases) {
      if (matchesShelf(item, "show")) show += 1;
      else if (matchesShelf(item, "cinema")) cinema += 1;
      else tv += 1;
    }
    return { all: releases.length, show, tv, cinema };
  }, [releases]);

  const savedInCatalogueCount = useMemo(
    () => releases.filter((item) => watchlist.includes(item.id)).length,
    [releases, watchlist],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const visible = useMemo(
    () =>
      releases.filter((item) => {
        const dayOk = pickedDays.length === 0 || pickedDays.includes(dayKey(item));
        const shelfOk =
          pickedShelves.length === 0 ||
          pickedShelves.some((shelf) => matchesShelf(item, shelf));
        const regionOk =
          pickedRegions.length === 0 ||
          pickedRegions.some((reg) => matchesRegionFilter(item, reg));
        const platformOk =
          pickedPlatforms.length === 0 ||
          pickedPlatforms.includes(normalizePlatformGroup(item.platform));
        const savedOk = !onlySaved || watchlist.includes(item.id);
        const ratingNum = item.rating ? Number(item.rating) : NaN;
        const ratingOk = !onlyHighRated || (!Number.isNaN(ratingNum) && ratingNum >= 7.0);
        const searchOk =
          !normalizedQuery ||
          item.title.toLowerCase().includes(normalizedQuery) ||
          item.platform.toLowerCase().includes(normalizedQuery) ||
          item.blurb.toLowerCase().includes(normalizedQuery) ||
          (item.languageLabel ?? REGION_LABEL[item.region])
            .toLowerCase()
            .includes(normalizedQuery);

        return (
          dayOk &&
          shelfOk &&
          regionOk &&
          platformOk &&
          savedOk &&
          ratingOk &&
          searchOk
        );
      }),
    [
      pickedDays,
      pickedShelves,
      pickedRegions,
      pickedPlatforms,
      onlySaved,
      onlyHighRated,
      normalizedQuery,
      watchlist,
      releases,
    ],
  );

  const hasActiveFilters =
    pickedDays.length > 0 ||
    pickedShelves.length > 0 ||
    pickedRegions.length > 0 ||
    pickedPlatforms.length > 0 ||
    onlySaved ||
    onlyHighRated ||
    normalizedQuery.length > 0;

  const clearAllFilters = useCallback(() => {
    setPickedDays([]);
    setPickedShelves([]);
    setPickedRegions([]);
    setPickedPlatforms([]);
    setOnlySaved(false);
    setOnlyHighRated(false);
    setSearchQuery("");
  }, []);

  const weeks = weekBands.filter((entry) =>
    visible.some((item) => item.week === entry.id),
  );

  const placeLine = pack
    ? `This week and next, from your local date · ${pack.zone}. Cinema follows ${pack.countryName}.`
    : isSnapshot
      ? "Showing the curated editorial snapshot while live calendars are offline."
      : "This week and next. Reading live cinema & streaming calendars for your country…";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 [overflow-anchor:none] sm:px-6 sm:py-12">
      <header className="mb-6 border-b border-line pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium tracking-widest text-accent uppercase">
            Monday to Sunday · Two-Week Release Guide
          </p>
          <div className="flex items-center gap-2">
            {pack ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Live calendar
              </span>
            ) : isSnapshot ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Saved snapshot
              </span>
            ) : null}
            {country ? (
              <button
                type="button"
                onClick={() => fetchLiveCatalogue(country, true)}
                disabled={refreshing || (!pack && !isSnapshot)}
                className="rounded-full border border-line bg-card px-2.5 py-1 text-xs font-medium text-fg transition hover:border-accent hover:text-accent disabled:opacity-50"
                title="Rebuild catalogue from live calendars"
              >
                {refreshing ? "Refreshing…" : "Refresh ↻"}
              </button>
            ) : null}
          </div>
        </div>

        <h1 className="mt-2 font-display text-4xl leading-tight font-semibold text-fg sm:text-5xl">
          OTT digest{range ? ` · ${range}` : ""}
        </h1>

        <p className="mt-3 max-w-xl text-base text-muted">
          {placeLine} Shows stay English, British, Bollywood and South Indian.
          Anime and reality shows are left out.
        </p>

        {/* Country selector + quick stats */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg">
            {!pack && !isSnapshot ? (
              "Checking this week’s calendars…"
            ) : (
              <>
                <span className="font-semibold text-accent">{visible.length}</span>{" "}
                {visible.length === 1 ? "title" : "titles"}
                {hasActiveFilters ? (
                  <span className="text-muted"> (of {releases.length})</span>
                ) : null}
                <span className="mx-2 text-line">·</span>
                <span className="text-muted">
                  {shelfCounts.show} shows · {shelfCounts.tv} streaming movies ·{" "}
                  {shelfCounts.cinema} cinema
                </span>
              </>
            )}
          </p>

          <div className="flex items-center gap-2">
            <label
              htmlFor="country-select"
              className="text-xs font-medium tracking-wide text-muted uppercase"
            >
              Cinema region
            </label>
            <select
              id="country-select"
              value={country || "US"}
              onChange={(e) => handleSelectCountry(e.target.value)}
              className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs font-medium text-fg focus:border-accent focus:outline-none"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label} ({c.code})
                </option>
              ))}
              {country && !COUNTRIES.some((c) => c.code === country) ? (
                <option value={country}>{country}</option>
              ) : null}
            </select>
          </div>
        </div>
      </header>

      <DateBar
        days={days}
        pickedDays={pickedDays}
        onToggleDay={(key) => setPickedDays((current) => toggleValue(current, key))}
        onClearDays={() => setPickedDays([])}
        todayKey={todayKey}
        pickedShelves={pickedShelves}
        shelfCounts={shelfCounts}
        onToggleShelf={(key) =>
          setPickedShelves((current) => toggleValue(current, key))
        }
        onClearShelves={() => setPickedShelves([])}
        availableRegions={availableRegions}
        pickedRegions={pickedRegions}
        onToggleRegion={(key) =>
          setPickedRegions((current) => toggleValue(current, key))
        }
        onClearRegions={() => setPickedRegions([])}
        availablePlatforms={availablePlatforms}
        pickedPlatforms={pickedPlatforms}
        onTogglePlatform={(name) =>
          setPickedPlatforms((current) => toggleValue(current, name))
        }
        onClearPlatforms={() => setPickedPlatforms([])}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onlySaved={onlySaved}
        savedCount={savedInCatalogueCount}
        onToggleOnlySaved={() => setOnlySaved((v) => !v)}
        onlyHighRated={onlyHighRated}
        onToggleOnlyHighRated={() => setOnlyHighRated((v) => !v)}
        sortMode={sortMode}
        onToggleSortMode={() =>
          setSortMode((m) => (m === "title" ? "rating" : "title"))
        }
        hasActiveFilters={hasActiveFilters}
        onClearAllFilters={clearAllFilters}
      />

      {!pack && !isSnapshot ? (
        <LoadingCatalogue onUseSnapshot={() => setUseSnapshotOverride(true)} />
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-line bg-card px-4 py-10 text-center">
          <p className="font-display text-lg font-medium text-fg">
            Nothing matches your current filters.
          </p>
          <p className="mt-1 text-sm text-muted">
            Try clearing a date, language, platform, or search term.
          </p>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearAllFilters}
              className="mt-4 rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:opacity-90"
            >
              Reset all filters
            </button>
          ) : null}
        </div>
      ) : (
        <Catalogue
          visible={visible}
          weeks={weeks}
          releases={releases}
          todayKey={todayKey}
          watchlist={watchlist}
          onToggleWatchlist={onToggleWatchlist}
          sortMode={sortMode}
          rangeYear={range}
          searchQuery={normalizedQuery}
        />
      )}

      <footer className="mt-10 border-t border-line pt-5 text-sm text-muted">
        <p>
          Cinema listings use the IMDb movie calendar for your selected country.
          Shows are streaming premieres, including Hindi and South Indian series,
          not broadcast network schedules. Movies on TV come from IMDb’s TV movie
          list and Indian streaming premieres. The saved snapshot is used if live
          sources cannot be reached.
        </p>
      </footer>
    </main>
  );
}

function LoadingCatalogue({ onUseSnapshot }: { onUseSnapshot: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-4">
        <div>
          <p className="text-sm font-medium text-fg">
            Building your live two-week digest…
          </p>
          <p className="text-xs text-muted">
            Checking TVMaze streaming premieres, IMDb regional cinema calendars, and
            Indian OTT schedules in parallel.
          </p>
        </div>
        <button
          type="button"
          onClick={onUseSnapshot}
          className="shrink-0 rounded-full border border-line bg-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent"
        >
          View saved snapshot now
        </button>
      </div>
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className="flex animate-pulse gap-4 rounded-2xl border border-line bg-card p-4"
        >
          <div className="h-40 w-28 shrink-0 rounded-lg bg-line/60" />
          <div className="flex-1 space-y-3 py-1">
            <div className="h-3 w-28 rounded bg-line/60" />
            <div className="h-6 w-3/5 rounded bg-line/60" />
            <div className="h-3 w-24 rounded bg-line/60" />
            <div className="space-y-2 pt-1">
              <div className="h-3 w-full rounded bg-line/60" />
              <div className="h-3 w-4/5 rounded bg-line/60" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const DateBar = memo(function DateBar({
  days,
  pickedDays,
  onToggleDay,
  onClearDays,
  todayKey,
  pickedShelves,
  shelfCounts,
  onToggleShelf,
  onClearShelves,
  availableRegions,
  pickedRegions,
  onToggleRegion,
  onClearRegions,
  availablePlatforms,
  pickedPlatforms,
  onTogglePlatform,
  onClearPlatforms,
  searchQuery,
  onSearchChange,
  onlySaved,
  savedCount,
  onToggleOnlySaved,
  onlyHighRated,
  onToggleOnlyHighRated,
  sortMode,
  onToggleSortMode,
  hasActiveFilters,
  onClearAllFilters,
}: {
  days: { key: string; label: string; count: number; isToday: boolean }[];
  pickedDays: string[];
  onToggleDay: (key: string) => void;
  onClearDays: () => void;
  todayKey: string;
  pickedShelves: ShelfName[];
  shelfCounts: { all: number; show: number; tv: number; cinema: number };
  onToggleShelf: (key: ShelfName) => void;
  onClearShelves: () => void;
  availableRegions: { key: RegionFilter; label: string; count: number }[];
  pickedRegions: RegionFilter[];
  onToggleRegion: (key: RegionFilter) => void;
  onClearRegions: () => void;
  availablePlatforms: { name: string; count: number }[];
  pickedPlatforms: string[];
  onTogglePlatform: (name: string) => void;
  onClearPlatforms: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onlySaved: boolean;
  savedCount: number;
  onToggleOnlySaved: () => void;
  onlyHighRated: boolean;
  onToggleOnlyHighRated: () => void;
  sortMode: SortMode;
  onToggleSortMode: () => void;
  hasActiveFilters: boolean;
  onClearAllFilters: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [moreDates, setMoreDates] = useState(false);
  const [showPlatforms, setShowPlatforms] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA" &&
        document.activeElement?.tagName !== "SELECT"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => {
      setMoreDates(el.scrollWidth - el.clientWidth - el.scrollLeft > 8);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [days]);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty(
        "--digest-bar",
        `${el.offsetHeight}px`,
      );
    };
    apply();
    const watcher = new ResizeObserver(apply);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [
    days,
    pickedDays,
    pickedShelves,
    pickedRegions,
    pickedPlatforms,
    showPlatforms,
  ]);

  const hasTodayInDays = days.some((d) => d.key === todayKey);

  return (
    <div
      ref={bar}
      className="sticky top-0 z-30 -mx-4 mb-6 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur-md [overflow-anchor:none] sm:-mx-6 sm:px-6"
    >
      {/* Search + Quick Toggles */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search titles, cast, platforms… (press /)"
            aria-label="Search releases"
            className="h-9 w-full rounded-full border border-line bg-card pr-8 pl-3.5 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="absolute inset-y-0 right-2.5 flex items-center text-muted hover:text-fg"
            >
              ×
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {hasTodayInDays ? (
            <SmallPill
              active={pickedDays.length === 1 && pickedDays[0] === todayKey}
              onClick={() => onToggleDay(todayKey)}
            >
              Today
            </SmallPill>
          ) : null}
          <SmallPill active={onlySaved} onClick={onToggleOnlySaved}>
            ★ Saved{savedCount > 0 ? ` (${savedCount})` : ""}
          </SmallPill>
          <SmallPill active={onlyHighRated} onClick={onToggleOnlyHighRated}>
            IMDb 7.0+
          </SmallPill>
          <SmallPill active={sortMode === "rating"} onClick={onToggleSortMode}>
            Sort: {sortMode === "rating" ? "Top rated ★" : "A–Z"}
          </SmallPill>
          <SmallPill
            active={showPlatforms || pickedPlatforms.length > 0}
            onClick={() => setShowPlatforms((v) => !v)}
          >
            Platforms
            {pickedPlatforms.length > 0 ? ` (${pickedPlatforms.length})` : ""}{" "}
            {showPlatforms ? "▴" : "▾"}
          </SmallPill>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={onClearAllFilters}
              className="h-8 shrink-0 rounded-full px-2.5 text-xs font-medium text-accent underline underline-offset-2 hover:opacity-80"
            >
              Reset
            </button>
          ) : null}
        </div>
      </div>

      {/* Date Row */}
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-xs font-medium tracking-wide text-muted uppercase">
          Date
        </span>
        <div className="relative min-w-0 flex-1">
          <div
            ref={scroller}
            className="flex gap-2 overflow-x-auto overflow-y-hidden pb-0.5"
          >
            <Chip active={pickedDays.length === 0} onClick={onClearDays}>
              All dates
            </Chip>
            {days.map((entry) => (
              <Chip
                key={entry.key}
                active={pickedDays.includes(entry.key)}
                onClick={() => onToggleDay(entry.key)}
              >
                {entry.isToday ? `Today · ${entry.label}` : entry.label}
              </Chip>
            ))}
          </div>
          {moreDates ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-bg to-transparent"
            />
          ) : null}
        </div>
      </div>

      {/* Type Row */}
      <div className="mt-2 flex items-center gap-3">
        <span className="w-12 shrink-0 text-xs font-medium tracking-wide text-muted uppercase">
          Type
        </span>
        <div className="flex gap-2 overflow-x-auto overflow-y-hidden">
          <Chip active={pickedShelves.length === 0} onClick={onClearShelves}>
            All ({shelfCounts.all})
          </Chip>
          <Chip
            active={pickedShelves.includes("show")}
            onClick={() => onToggleShelf("show")}
          >
            Shows ({shelfCounts.show})
          </Chip>
          <Chip
            active={pickedShelves.includes("tv")}
            onClick={() => onToggleShelf("tv")}
          >
            Movies on TV ({shelfCounts.tv})
          </Chip>
          <Chip
            active={pickedShelves.includes("cinema")}
            onClick={() => onToggleShelf("cinema")}
          >
            Cinema ({shelfCounts.cinema})
          </Chip>
        </div>
      </div>

      {/* Language / Region Row (Always Visible) */}
      {availableRegions.length > 0 ? (
        <div className="mt-2 flex items-center gap-3">
          <span className="w-12 shrink-0 text-xs font-medium tracking-wide text-muted uppercase">
            Lang
          </span>
          <div className="flex gap-1.5 overflow-x-auto overflow-y-hidden">
            <SmallPill
              active={pickedRegions.length === 0}
              onClick={onClearRegions}
            >
              All
            </SmallPill>
            {availableRegions.map((reg) => (
              <SmallPill
                key={reg.key}
                active={pickedRegions.includes(reg.key)}
                onClick={() => onToggleRegion(reg.key)}
              >
                {reg.label} ({reg.count})
              </SmallPill>
            ))}
          </div>
        </div>
      ) : null}

      {/* Expandable Platform Row */}
      {showPlatforms && availablePlatforms.length > 0 ? (
        <div className="mt-2 flex items-center gap-3 border-t border-line/70 pt-2">
          <span className="w-12 shrink-0 text-xs font-medium tracking-wide text-muted uppercase">
            Where
          </span>
          <div className="flex gap-1.5 overflow-x-auto overflow-y-hidden">
            <SmallPill
              active={pickedPlatforms.length === 0}
              onClick={onClearPlatforms}
            >
              All platforms
            </SmallPill>
            {availablePlatforms.map((plat) => (
              <SmallPill
                key={plat.name}
                active={pickedPlatforms.includes(plat.name)}
                onClick={() => onTogglePlatform(plat.name)}
              >
                {plat.name} ({plat.count})
              </SmallPill>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});

function Catalogue({
  visible,
  weeks,
  releases,
  todayKey,
  watchlist,
  onToggleWatchlist,
  sortMode,
  rangeYear,
  searchQuery,
}: {
  visible: Release[];
  weeks: { id: 1 | 2; label: string; hint: string }[];
  releases: Release[];
  todayKey: string;
  watchlist: string[];
  onToggleWatchlist: (id: string) => void;
  sortMode: SortMode;
  rangeYear: string;
  searchQuery: string;
}) {
  const [live, setLive] = useState<LiveRatings>({});
  const [ratingsReady, setRatingsReady] = useState(false);
  const idList = releases
    .map(imdbId)
    .filter((id): id is string => Boolean(id))
    .join(",");

  useEffect(() => {
    const ids = [...new Set(idList.split(",").filter(Boolean))];
    if (ids.length === 0) {
      setRatingsReady(true);
      return;
    }
    let cancel = false;
    setLive({});
    setRatingsReady(false);
    (async () => {
      for (let i = 0; i < ids.length; i += 16) {
        try {
          const batch = await getLiveRatings({
            data: { ids: ids.slice(i, i + 16) },
          });
          if (cancel) return;
          setLive((current) => ({ ...current, ...batch }));
        } catch {
          // This batch failed. Saved scores are used once loading finishes.
        }
      }
      if (!cancel) setRatingsReady(true);
    })();
    return () => {
      cancel = true;
    };
  }, [idList]);

  function scoreFor(item: Release) {
    const id = imdbId(item);
    if (!id) return item.rating ?? null;
    if (id in live && live[id] !== null) return live[id];
    if (item.rating) return item.rating;
    if (id in live) return live[id];
    if (!ratingsReady) return undefined;
    return null;
  }

  if (visible.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-card px-4 py-8 text-center text-sm text-muted">
        Nothing confirmed on this date.
      </p>
    );
  }

  return weeks.map((entry) => {
    const inWeek = visible.filter((item) => item.week === entry.id);
    if (inWeek.length === 0) return null;
    return (
      <section key={entry.id} className="mb-10">
        <div className="flex items-baseline justify-between border-b border-line/60 pb-2">
          <h2 className="font-display text-2xl font-semibold text-fg">
            {entry.hint}
            <span className="ml-2 text-base font-medium text-muted">
              {entry.label}
            </span>
          </h2>
          <span className="text-xs font-medium text-muted">
            {inWeek.length} {inWeek.length === 1 ? "release" : "releases"}
          </span>
        </div>
        <div className="mt-5 flex flex-col gap-8">
          {WEEKDAYS.map((name, index) => {
            const rawItems = inWeek.filter((item) => item.weekday === index);
            if (rawItems.length === 0) return null;
            const items =
              sortMode === "rating"
                ? [...rawItems].sort((a, b) => {
                    const ra = Number(scoreFor(a) ?? -1);
                    const rb = Number(scoreFor(b) ?? -1);
                    if (rb !== ra) return rb - ra;
                    return a.title.localeCompare(b.title);
                  })
                : rawItems;
            const isTodaySection = `${entry.id}-${index}` === todayKey;

            return (
              <div key={name}>
                <h3 className="sticky top-[var(--digest-bar,8.5rem)] z-20 -mx-4 flex items-center justify-between border-b border-line bg-bg/95 px-4 py-2 font-display text-xl font-semibold text-accent backdrop-blur-sm [overflow-anchor:none] sm:-mx-6 sm:px-6">
                  <span>
                    {name}
                    <span className="ml-2 text-sm font-medium text-muted">
                      {items[0].day}
                    </span>
                    {isTodaySection ? (
                      <span className="ml-2.5 inline-flex items-center rounded-full bg-accent/20 px-2 py-0.5 font-sans text-xs font-semibold text-accent">
                        Today
                      </span>
                    ) : null}
                  </span>
                  <span className="font-sans text-xs font-normal text-muted">
                    {items.length} {items.length === 1 ? "title" : "titles"}
                  </span>
                </h3>
                <ul className="mt-3 flex flex-col gap-3">
                  {items.map((item) => {
                    const score = scoreFor(item);
                    const isSaved = watchlist.includes(item.id);
                    const highScore = score && Number(score) >= 7.5;
                    const trailerUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
                      `${item.title} ${item.kind === "series" ? "series" : "movie"} official trailer`,
                    )}`;

                    return (
                      <li key={item.id}>
                        <article className="group flex gap-3 rounded-2xl border border-line bg-card p-3 transition hover:border-line/90 sm:gap-4 sm:p-4">
                          <div className="flex w-28 shrink-0 flex-col gap-1.5">
                            <Poster item={item} />
                            {item.imdb ? (
                              <p className="h-5 text-center text-xs leading-5 font-medium tabular-nums">
                                {score ? (
                                  <a
                                    href={item.imdb}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={
                                      highScore
                                        ? "inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 text-accent hover:bg-accent/25"
                                        : "text-accent hover:underline"
                                    }
                                  >
                                    ★ IMDb {score}
                                  </a>
                                ) : score === undefined ? (
                                  <span className="text-muted">…</span>
                                ) : null}
                              </p>
                            ) : null}
                          </div>

                          <div className="flex min-w-0 flex-1 flex-col justify-between">
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-xs font-medium tracking-wide text-accent">
                                  {item.languageLabel ?? REGION_LABEL[item.region]}
                                  {" · "}
                                  {shelfLabel(item)}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => onToggleWatchlist(item.id)}
                                  aria-pressed={isSaved}
                                  title={
                                    isSaved
                                      ? "Remove from saved watchlist"
                                      : "Save to your watchlist"
                                  }
                                  className={
                                    isSaved
                                      ? "shrink-0 rounded-full bg-accent/20 px-2.5 py-0.5 text-xs font-medium text-accent transition hover:bg-accent/30"
                                      : "shrink-0 rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-muted transition hover:border-accent hover:text-fg"
                                  }
                                >
                                  {isSaved ? "★ Saved" : "☆ Save"}
                                </button>
                              </div>

                              <h4 className="mt-1 font-display text-xl leading-tight font-semibold text-fg">
                                {item.imdb ? (
                                  <a
                                    href={item.imdb}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline decoration-line underline-offset-4 hover:text-accent"
                                  >
                                    <HighlightText
                                      text={item.title}
                                      query={searchQuery}
                                    />
                                  </a>
                                ) : (
                                  <HighlightText
                                    text={item.title}
                                    query={searchQuery}
                                  />
                                )}
                              </h4>

                              <p className="mt-1 text-sm font-medium text-muted">
                                <HighlightText
                                  text={item.platform}
                                  query={searchQuery}
                                />
                              </p>

                              <p className="mt-2 text-sm leading-relaxed text-fg">
                                <HighlightText
                                  text={item.blurb}
                                  query={searchQuery}
                                />
                              </p>
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line/50 pt-2 text-xs text-muted">
                              <a
                                href={trailerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:text-accent"
                              >
                                Watch trailer ↗
                              </a>
                              {item.imdb ? (
                                <a
                                  href={item.imdb}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:text-accent"
                                >
                                  IMDb page ↗
                                </a>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => downloadIcsReminder(item, rangeYear)}
                                className="hover:text-accent"
                              >
                                + Calendar reminder
                              </button>
                            </div>
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    );
  });
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return (
    <>
      {before}
      <mark className="rounded bg-accent/30 px-0.5 text-fg">{match}</mark>
      {after}
    </>
  );
}

function Poster({ item }: { item: Release }) {
  const [failed, setFailed] = useState(false);
  const src =
    item.poster ?? (MISSING.has(item.id) ? "" : `/digest/${item.id}.jpg`);
  if (!src || failed) {
    return (
      <div
        aria-hidden="true"
        className="flex h-40 w-28 shrink-0 items-center justify-center rounded-lg border border-line bg-bg font-display text-3xl text-accent"
      >
        {item.title.slice(0, 1)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={item.alt ?? `${item.title} poster`}
      width={112}
      height={168}
      loading="lazy"
      className="h-40 w-28 shrink-0 rounded-lg bg-bg object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "min-h-10 shrink-0 rounded-full bg-accent px-3 text-sm font-medium text-bg transition"
          : "min-h-10 shrink-0 rounded-full border border-line px-3 text-sm font-medium text-fg transition hover:border-accent/60"
      }
    >
      {children}
    </button>
  );
}

function SmallPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "h-8 shrink-0 rounded-full bg-accent px-2.5 text-xs font-medium text-bg transition"
          : "h-8 shrink-0 rounded-full border border-line bg-card px-2.5 text-xs font-medium text-fg transition hover:border-accent/60"
      }
    >
      {children}
    </button>
  );
}
