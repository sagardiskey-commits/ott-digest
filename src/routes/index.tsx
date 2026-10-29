import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  RELEASES,
  REGION_LABEL,
  WEEKDAYS,
  WEEKS,
  type Release,
} from "@/data/releases";
import { getCatalogue, type CatalogueResult } from "@/lib/catalogue";
import { getLiveRatings, type LiveRatings } from "@/lib/ratings";

export const Route = createFileRoute("/")({ component: Home });

/** No usable poster found. Don't request a missing file. */
const MISSING = new Set(["big-girls"]);

function dayKey(item: Release) {
  return `${item.week}-${item.weekday}`;
}

function shortDate(day: string, weekday: number) {
  const [n, month] = day.split(" ");
  return `${WEEKDAYS[weekday].slice(0, 3)} ${n} ${month.slice(0, 3)}`;
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

type ShelfName = "show" | "tv" | "cinema";

function matchesShelf(item: Release, shelf: ShelfName) {
  if (shelf === "show") return item.kind === "series";
  if (shelf === "cinema") return item.kind === "movie" && item.place === "cinema";
  return item.kind === "movie" && item.place === "streaming";
}

function toggleValue<T>(list: T[], value: T) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function shelfLabel(item: Release) {
  if (item.kind === "series") return "Show";
  if (item.place === "cinema") return "Cinema";
  return "Movie on TV";
}

function Home() {
  const [pickedDays, setPickedDays] = useState<string[]>([]);
  const [pickedShelves, setPickedShelves] = useState<ShelfName[]>([]);
  const [pack, setPack] = useState<CatalogueResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [timeZone] = useState(visitorTimeZone);
  const [country, setCountry] = useState("");

  useEffect(() => {
    let cancel = false;
    detectCountry(timeZone).then((code) => {
      if (!cancel) setCountry(code);
    });
    return () => {
      cancel = true;
    };
  }, [timeZone]);

  useEffect(() => {
    if (!country) return;
    let cancel = false;
    setPack(null);
    setFailed(false);
    getCatalogue({ data: { timeZone, country } })
      .then((data) => {
        if (!cancel) setPack(data);
      })
      .catch(() => {
        if (!cancel) setFailed(true);
      });
    return () => {
      cancel = true;
    };
  }, [timeZone, country]);

  const releases = pack?.releases ?? (failed ? RELEASES : []);
  const weekBands = pack?.weeks ?? WEEKS;
  const range = pack?.range ?? (failed ? "28 Sep – 11 Oct 2026" : "");

  const days = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of releases) {
      const key = dayKey(item);
      if (!map.has(key)) map.set(key, shortDate(item.day, item.weekday));
    }
    return [...map.entries()].map(([key, label]) => ({ key, label }));
  }, [releases]);

  const visible = useMemo(
    () =>
      releases.filter((item) => {
        const dayOk = pickedDays.length === 0 || pickedDays.includes(dayKey(item));
        const shelfOk =
          pickedShelves.length === 0 ||
          pickedShelves.some((shelf) => matchesShelf(item, shelf));
        return dayOk && shelfOk;
      }),
    [pickedDays, pickedShelves, releases],
  );

  const weeks = weekBands.filter((entry) =>
    visible.some((item) => item.week === entry.id),
  );

  const placeLine = pack
    ? `This week and next, from your local date · ${pack.zone}. Cinema follows ${pack.countryName}.`
    : "This week and next. Finding your country for cinema listings.";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 [overflow-anchor:none] sm:px-6 sm:py-12">
      <header className="mb-6 border-b border-line pb-6">
        <p className="text-xs font-medium tracking-widest text-accent uppercase">
          Monday to Sunday
        </p>
        <h1 className="mt-2 font-display text-4xl leading-tight font-semibold text-fg sm:text-5xl">
          OTT digest{range ? ` · ${range}` : ""}
        </h1>
        <p className="mt-3 max-w-xl text-base text-muted">
          {placeLine} Shows stay English, British, Bollywood and South Indian.
          Anime and reality shows are left out.
        </p>
        <p className="mt-3 text-sm text-fg">
          {!pack && !failed
            ? "Checking this week’s calendars…"
            : `${visible.length} ${visible.length === 1 ? "title" : "titles"}`}
        </p>
      </header>

      <DateBar
        days={days}
        pickedDays={pickedDays}
        onToggleDay={(key) => setPickedDays((current) => toggleValue(current, key))}
        onClearDays={() => setPickedDays([])}
        pickedShelves={pickedShelves}
        onToggleShelf={(key) => setPickedShelves((current) => toggleValue(current, key))}
        onClearShelves={() => setPickedShelves([])}
      />

      {!pack && !failed ? (
        <p className="rounded-2xl border border-line bg-card px-4 py-8 text-center text-sm text-muted">
          Reading cinema for your country, plus the usual streaming list.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-line bg-card px-4 py-8 text-center text-sm text-muted">
          Nothing matches this filter.
        </p>
      ) : (
        <Catalogue visible={visible} weeks={weeks} releases={releases} />
      )}

      <p className="border-t border-line pt-4 text-sm text-muted">
        Cinema listings use the IMDb movie calendar for your country. Shows are
        streaming premieres, including Hindi and South Indian series, not
        broadcast network schedules. Movies on TV come from IMDb’s TV movie list
        and Indian streaming premieres. The saved list is only used if those
        sources cannot be reached.
      </p>
    </main>
  );
}

const DateBar = memo(function DateBar({
  days,
  pickedDays,
  onToggleDay,
  onClearDays,
  pickedShelves,
  onToggleShelf,
  onClearShelves,
}: {
  days: { key: string; label: string }[];
  pickedDays: string[];
  onToggleDay: (key: string) => void;
  onClearDays: () => void;
  pickedShelves: ShelfName[];
  onToggleShelf: (key: ShelfName) => void;
  onClearShelves: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [moreDates, setMoreDates] = useState(false);

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
      document.documentElement.style.setProperty("--digest-bar", `${el.offsetHeight}px`);
    };
    apply();
    const watcher = new ResizeObserver(apply);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [days, pickedDays, pickedShelves]);

  return (
    <div
      ref={bar}
      className="sticky top-0 z-30 -mx-4 mb-6 border-b border-line bg-bg px-4 py-3 [overflow-anchor:none] sm:-mx-6 sm:px-6"
    >
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-xs font-medium tracking-wide text-muted uppercase">
          Date
        </span>
        <div className="relative min-w-0 flex-1">
          <div ref={scroller} className="flex gap-2 overflow-x-auto overflow-y-hidden">
            <Chip active={pickedDays.length === 0} onClick={onClearDays}>
              All dates
            </Chip>
            {days.map((entry) => (
              <Chip
                key={entry.key}
                active={pickedDays.includes(entry.key)}
                onClick={() => onToggleDay(entry.key)}
              >
                {entry.label}
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
      <div className="mt-2 flex items-center gap-3">
        <span className="w-12 shrink-0 text-xs font-medium tracking-wide text-muted uppercase">
          Type
        </span>
        <div className="flex gap-2 overflow-x-auto overflow-y-hidden">
          <Chip active={pickedShelves.length === 0} onClick={onClearShelves}>
            All
          </Chip>
          <Chip active={pickedShelves.includes("show")} onClick={() => onToggleShelf("show")}>
            Shows
          </Chip>
          <Chip active={pickedShelves.includes("tv")} onClick={() => onToggleShelf("tv")}>
            Movies on TV
          </Chip>
          <Chip
            active={pickedShelves.includes("cinema")}
            onClick={() => onToggleShelf("cinema")}
          >
            Cinema
          </Chip>
        </div>
      </div>
    </div>
  );
});

function Catalogue({
  visible,
  weeks,
  releases,
}: {
  visible: Release[];
  weeks: { id: 1 | 2; label: string; hint: string }[];
  releases: Release[];
}) {
  const [live, setLive] = useState<LiveRatings>({});
  const [ratingsReady, setRatingsReady] = useState(false);
  const idList = releases.map(imdbId).filter((id): id is string => Boolean(id)).join(",");

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
      for (let i = 0; i < ids.length; i += 8) {
        try {
          const batch = await getLiveRatings({
            data: { ids: ids.slice(i, i + 8) },
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
    if (!id) return null;
    if (id in live) return live[id];
    if (!ratingsReady) return undefined;
    return item.rating ?? null;
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
        <h2 className="font-display text-2xl font-semibold text-fg">
          {entry.hint}
          <span className="ml-2 text-base font-medium text-muted">
            {entry.label}
          </span>
        </h2>
        <div className="mt-5 flex flex-col gap-8">
          {WEEKDAYS.map((name, index) => {
            const items = inWeek.filter((item) => item.weekday === index);
            if (items.length === 0) return null;
            return (
              <div key={name}>
                <h3 className="sticky top-[var(--digest-bar,8.5rem)] z-20 -mx-4 border-b border-line bg-bg px-4 py-2 font-display text-xl font-semibold text-accent [overflow-anchor:none] sm:-mx-6 sm:px-6">
                  {name}
                  <span className="ml-2 text-sm font-medium text-muted">
                    {items[0].day}
                  </span>
                </h3>
                <ul className="mt-3 flex flex-col gap-3">
                  {items.map((item) => {
                    const score = scoreFor(item);
                    return (
                      <li key={item.id}>
                        <article className="flex gap-3 rounded-2xl border border-line bg-card p-3 sm:gap-4 sm:p-4">
                          <div className="flex w-28 shrink-0 flex-col gap-1.5">
                            <Poster item={item} />
                            {item.imdb ? (
                              <p className="h-4 text-center text-xs leading-4 font-medium text-accent tabular-nums">
                                {score ? (
                                  <a
                                    href={item.imdb}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-accent"
                                  >
                                    IMDb {score}
                                  </a>
                                ) : score === undefined ? (
                                  <span className="text-muted">…</span>
                                ) : null}
                              </p>
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium tracking-wide text-accent">
                              {item.languageLabel ?? REGION_LABEL[item.region]}
                              {" · "}
                              {shelfLabel(item)}
                            </p>
                            <h4 className="mt-1 font-display text-xl leading-tight font-semibold text-fg">
                              {item.imdb ? (
                                <a
                                  href={item.imdb}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline decoration-line underline-offset-4 hover:text-accent"
                                >
                                  {item.title}
                                </a>
                              ) : (
                                item.title
                              )}
                            </h4>
                            <p className="mt-1 text-sm text-muted">{item.platform}</p>
                            <p className="mt-2 text-sm leading-relaxed text-fg">
                              {item.blurb}
                            </p>
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

function Poster({ item }: { item: Release }) {
  const [failed, setFailed] = useState(false);
  const src = item.poster ?? (MISSING.has(item.id) ? "" : `/digest/${item.id}.jpg`);
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
          ? "min-h-11 shrink-0 rounded-full bg-accent px-3 text-sm font-medium text-bg"
          : "min-h-11 shrink-0 rounded-full border border-line px-3 text-sm font-medium text-fg"
      }
    >
      {children}
    </button>
  );
}
