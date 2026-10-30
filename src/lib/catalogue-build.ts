import { REGION_LABEL, type Region, type Release } from "../data/releases.ts";
import { primeRatingCache } from "./rating-cache.ts";

export type WeekBand = { id: 1 | 2; label: string; hint: string };

export type CatalogueResult = {
  releases: Release[];
  weeks: WeekBand[];
  range: string;
  zone: string;
  country: string;
  countryName: string;
  todayKey: string;
  updatedAt: string;
};

const MONTHS = [
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
];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_INDEX: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const LANGUAGE: Record<string, Region> = {
  english: "english",
  hindi: "hindi",
  tamil: "tamil",
  telugu: "telugu",
  malayalam: "malayalam",
  kannada: "kannada",
};

const KERALA_LANG: Record<string, Region> = {
  hi: "hindi",
  hindi: "hindi",
  ta: "tamil",
  tamil: "tamil",
  te: "telugu",
  telugu: "telugu",
  ml: "malayalam",
  malayalam: "malayalam",
  kn: "kannada",
  kannada: "kannada",
  english: "english",
  en: "english",
};

const KERALA_PLATFORM: Record<string, string> = {
  netflix: "Netflix",
  "prime-video": "Prime Video",
  jiohotstar: "JioHotstar",
  sonyliv: "SonyLIV",
  zee5: "ZEE5",
  "sun-nxt": "Sun NXT",
  manoramamax: "ManoramaMAX",
  "saina-play": "Saina Play",
  lionsgateplay: "Lionsgate Play",
  aha: "Aha",
  simplysouth: "Simply South",
  starzplay: "STARZ PLAY",
  mxplayer: "Amazon MX Player",
  youtube: "YouTube",
  shortflix: "ShortFlix",
  watcho: "Watcho OTT",
  shemaroome: "ShemarooMe",
  hungamaott: "Hungama OTT",
  airtelxstream: "Airtel Xstream",
  tataplaybinge: "Tata Play Binge",
  "tiger-tv": "Tiger TV",
};

type MovieHit = {
  tt: string;
  title: string;
  date: string;
  poster?: string;
  genres?: string[];
  sources: Set<string>;
  onMovie: boolean;
  onTv: boolean;
};

const cache = new Map<string, { at: number; data: CatalogueResult }>();

/**
 * Concurrency limiter + retry for `r.jina.ai` so Vercel / serverless IPs
 * never burst-trip Jina's rate limit (HTTP 429).
 */
let activeJina = 0;
const jinaQueue: (() => void)[] = [];
const MAX_CONCURRENT_JINA = 2;

async function withJinaSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeJina >= MAX_CONCURRENT_JINA) {
    await new Promise<void>((resolve) => jinaQueue.push(resolve));
  }
  activeJina += 1;
  try {
    return await fn();
  } finally {
    activeJina -= 1;
    const next = jinaQueue.shift();
    if (next) next();
  }
}

export async function readJinaText(targetUrl: string, timeoutMs = 15000): Promise<string> {
  return withJinaSlot(async () => {
    const jinaUrl = `https://r.jina.ai/${targetUrl}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(jinaUrl, {
        headers: { accept: "text/plain", "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 900));
        continue;
      }
      if (!response.ok) throw new Error(String(response.status));
      return response.text();
    }
    throw new Error("429");
  });
}

export function safeCountry(value: string | undefined) {
  const code = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "US";
}

function countryName(code: string) {
  try {
    return new Intl.DisplayNames("en", { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

export function safeTimeZone(value: string | undefined) {
  if (!value) return "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

function zoneLabel(timeZone: string, now: Date) {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longGeneric",
  })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value;
  return name || timeZone;
}

function localDateParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

export function windowBounds(now: Date, timeZone: string) {
  const { year, month, day } = localDateParts(now, timeZone);
  const today = new Date(Date.UTC(year, month - 1, day));
  const dow = today.getUTCDay();
  const todayWeekday = dow === 0 ? 6 : dow - 1;
  const start = new Date(today);
  start.setUTCDate(today.getUTCDate() - todayWeekday);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 13);
  return { start, end, today, todayWeekday };
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(date.getUTCDate() + days);
  return next;
}

function parseIso(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function weekdayIndex(value: string) {
  const js = parseIso(value).getUTCDay();
  return js === 0 ? 6 : js - 1;
}

function dayLabel(value: string) {
  const date = parseIso(value);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

function shortDay(date: Date) {
  return `${date.getUTCDate()} ${MONTH_SHORT[date.getUTCMonth()]}`;
}

function weekLabel(start: Date, end: Date) {
  if (start.getUTCMonth() === end.getUTCMonth()) {
    return `${start.getUTCDate()} – ${end.getUTCDate()} ${MONTH_SHORT[end.getUTCMonth()]}`;
  }
  return `${shortDay(start)} – ${shortDay(end)}`;
}

function cleanTitle(title: string) {
  return title.replace(/\s+\(\d{4}(?:\s*[–-]\s*)?\)$/, "").trim();
}

function plain(html: string | null | undefined) {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#8217;|&#39;|&apos;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function largerPoster(url: string | undefined) {
  if (!url) return undefined;
  const base = url.split("._V1_")[0];
  if (!base.includes("/images/M/")) return url;
  return `${base}._V1_SX400.jpg`;
}

function parseImdbDate(line: string) {
  const match = line.match(/^#### ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/);
  if (!match) return null;
  const month = MONTH_INDEX[match[1]];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function regionFromLanguage(language: string | undefined, country: string | undefined): Region | null {
  const languages = (language ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  for (const name of languages) {
    if (name === "english") {
      const where = country ?? "";
      if (/united kingdom/i.test(where) && !/united states/i.test(where)) return "british";
      return "english";
    }
    if (LANGUAGE[name]) return LANGUAGE[name];
  }
  return null;
}

function describeTitle(language: string | undefined, origin: string | undefined) {
  const mapped = regionFromLanguage(language, origin);
  if (mapped) return { region: mapped, languageLabel: undefined as string | undefined };
  const first = language?.split(",")[0]?.trim();
  const validFirst = first && first !== "N/A" ? first : undefined;
  const validOrigin = origin && origin !== "N/A" ? origin : undefined;
  return { region: "local" as const, languageLabel: validFirst || validOrigin || undefined };
}

function isAnime(genres: string[] | undefined, language: string | undefined, country: string | undefined) {
  const names = (genres ?? []).map((genre) => genre.toLowerCase());
  if (names.includes("anime")) return true;
  const animated = names.includes("animation");
  const japanese = /japanese/i.test(language ?? "") || /japan/i.test(country ?? "");
  return animated && japanese;
}

function isReality(type: string | undefined, genres: string[] | undefined) {
  if (/reality/i.test(type ?? "")) return true;
  return (genres ?? []).some((genre) => /reality|game-show|talk-show/i.test(genre));
}

export function parseCalendar(markdown: string, source: string, kind: "movie" | "series") {
  let date: string | null = null;
  let poster: string | undefined;
  const hits: MovieHit[] = [];
  for (const line of markdown.split("\n")) {
    const nextDate = parseImdbDate(line);
    if (nextDate) {
      date = nextDate;
      poster = undefined;
      continue;
    }
    const image = line.match(/\((https:\/\/m\.media-amazon\.com\/images\/M\/[^)]+)\)/);
    if (image) poster = largerPoster(image[1]);
    const title = line.match(/^\[(.+?)\]\(https:\/\/www\.imdb\.com\/title\/(tt\d+)/);
    if (!title || !date) continue;
    hits.push({
      tt: title[2],
      title: cleanTitle(title[1]),
      date,
      poster,
      sources: new Set([source]),
      onMovie: kind === "movie",
      onTv: kind === "series",
    });
    poster = undefined;
  }
  return hits;
}

async function imdbCalendar(source: string, type: "MOVIE" | "TV") {
  const kind = type === "MOVIE" ? "movie" : "series";
  const markdown = await readJinaText(
    `https://www.imdb.com/calendar/?region=${source}&type=${type}`,
  );
  return parseCalendar(markdown, source, kind);
}

function looseDate(text: string) {
  const match = text.match(/\b([A-Z][a-z]{2}) (\d{1,2}), (\d{4})\b/);
  if (!match) return null;
  const month = MONTH_INDEX[match[1]];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function parseOmdbReleasedDate(released: string | undefined): string | null {
  if (!released || released === "N/A") return null;
  // Format: "02 Oct 2026"
  const match = released.match(/^(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTH_INDEX[match[2]];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function regionForCountry(code: string) {
  if (code === "GB") return { region: "british" as const, languageLabel: undefined };
  if (code === "US" || code === "AU" || code === "CA" || code === "NZ" || code === "IE") {
    return { region: "english" as const, languageLabel: undefined };
  }
  if (code === "IN") return { region: "hindi" as const, languageLabel: undefined };
  return { region: "local" as const, languageLabel: countryName(code) };
}

export function parseTvMovies(markdown: string) {
  const found: {
    tt: string;
    title: string;
    date: string;
    poster?: string;
    blurb?: string;
    tv: boolean;
    anime: boolean;
  }[] = [];
  let poster: string | undefined;
  let current: (typeof found)[number] | null = null;
  const flush = () => {
    if (current?.tv && !current.anime) found.push(current);
    current = null;
  };
  for (const line of markdown.split("\n")) {
    const image = line.match(/\((https:\/\/m\.media-amazon\.com\/images\/M\/[^)]+)\)/);
    if (image) poster = largerPoster(image[1]);
    const title = line.match(
      /^#{2,4} \[\d+\.\s*(.+?)\]\(https:\/\/www\.imdb\.com\/title\/(tt\d+)/,
    );
    if (title) {
      flush();
      current = {
        tt: title[2],
        title: cleanTitle(title[1]),
        date: "",
        poster,
        tv: false,
        anime: false,
      };
      poster = undefined;
      continue;
    }
    if (!current) continue;
    const released = line.match(/(?:Releases|Expected)\s+([A-Z][a-z]{2} \d{1,2}, \d{4})/i);
    if (released) current.date = looseDate(released[1]) ?? current.date;
    if (/TV Movie/i.test(line)) current.tv = true;
    if (/\banime\b/i.test(line)) current.anime = true;
    if (
      !current.blurb &&
      line.trim().length > 80 &&
      !line.startsWith("*") &&
      !line.startsWith("#") &&
      !line.startsWith("!") &&
      !line.startsWith("[")
    ) {
      current.blurb = line.trim();
    }
  }
  flush();
  return found;
}

async function tvMoviePremieres(start: Date, end: Date, userCountry: string) {
  const countries = [...new Set([userCountry, "US", "GB", "IN"])];
  const countryParam = countries.join(",");
  const pages = await Promise.all([
    readJinaText(
      `https://www.imdb.com/search/title/?title_type=tv_movie&release_date=${iso(start)},${iso(end)}&sort=release_date,asc&countries=${countryParam}`,
    )
      .then((markdown) => parseTvMovies(markdown).map((item) => ({ ...item, code: userCountry })))
      .catch(() => []),
    readJinaText(
      `https://www.imdb.com/search/title/?title_type=tv_movie&release_date=${iso(start)},${iso(end)}&sort=release_date,asc`,
    )
      .then((markdown) => parseTvMovies(markdown).map((item) => ({ ...item, code: "" })))
      .catch(() => []),
  ]);

  const rawItems = pages.flat();
  const uniqueByTt = new Map<string, (typeof rawItems)[number]>();
  for (const item of rawItems) {
    const existing = uniqueByTt.get(item.tt);
    if (!existing) {
      uniqueByTt.set(item.tt, item);
    } else {
      if (!existing.date && item.date) existing.date = item.date;
      if (!existing.code && item.code) existing.code = item.code;
      if (!existing.poster && item.poster) existing.poster = item.poster;
      if (!existing.blurb && item.blurb) existing.blurb = item.blurb;
    }
  }

  // Enrich with OMDb to resolve missing release dates (for already-released titles in the current week)
  // and accurate language/region/rating metadata
  const candidates = [...uniqueByTt.values()];
  const releases: Release[] = [];
  for (let index = 0; index < candidates.length; index += 8) {
    const chunk = candidates.slice(index, index + 8);
    await Promise.all(
      chunk.map(async (item) => {
        const meta = await omdb(item.tt).catch(() => null);
        const details = meta && meta !== "limit" ? meta : null;
        if (details && isAnime(details.Genre?.split(", "), details.Language, details.Country)) {
          return;
        }
        const resolvedDate = item.date || parseOmdbReleasedDate(details?.Released) || "";
        if (!resolvedDate || resolvedDate < iso(start) || resolvedDate > iso(end)) return;

        let described = details
          ? describeTitle(details.Language, details.Country)
          : item.code
            ? regionForCountry(item.code)
            : { region: "english" as const, languageLabel: undefined };
        if (described.region === "local" && item.code) {
          const fallback = regionForCountry(item.code);
          if (fallback.region !== "local") described = fallback;
        }

        const plot =
          item.blurb ||
          (details?.Plot && details.Plot !== "N/A" ? details.Plot : "") ||
          "Premieres on TV this week.";
        const poster =
          item.poster ||
          (details?.Poster && details.Poster !== "N/A" ? largerPoster(details.Poster) : undefined);
        const rating =
          details?.imdbRating && /^\d\.\d$/.test(details.imdbRating)
            ? details.imdbRating
            : undefined;

        releases.push({
          id: item.tt,
          title: item.title,
          week: resolvedDate < iso(addDays(start, 7)) ? 1 : 2,
          weekday: weekdayIndex(resolvedDate),
          day: dayLabel(resolvedDate),
          kind: "movie",
          region: described.region,
          languageLabel: described.languageLabel,
          place: "streaming",
          platform: "Television",
          blurb: plot,
          imdb: `https://www.imdb.com/title/${item.tt}/`,
          rating,
          poster,
        });
      }),
    );
  }
  return releases;
}

type MazeShow = {
  id: number;
  name: string;
  type?: string;
  language: string | null;
  genres: string[];
  summary: string | null;
  rating?: { average?: number | null };
  image: { original?: string } | null;
  network: { name: string; country?: { code?: string; name?: string } | null } | null;
  webChannel: { name: string; country?: { code?: string; name?: string } | null } | null;
  externals?: { imdb?: string | null };
};

async function fetchTvmazeDay(date: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`https://api.tvmaze.com/schedule/web?date=${date}`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) return [];
      return (await response.json()) as {
        season: number;
        number: number;
        airdate: string;
        image: { original?: string } | null;
        _embedded?: { show?: MazeShow };
      }[];
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 250));
    }
  }
  return [];
}

async function streamingPremieres(start: Date, end: Date) {
  const days: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    days.push(iso(cursor));
  }
  const rows: Release[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < days.length; index += 7) {
    const chunk = days.slice(index, index + 7);
    const lists = await Promise.all(chunk.map(fetchTvmazeDay));
    for (const list of lists) {
      for (const episode of list) {
        if (episode.number !== 1) continue;
        const show = episode._embedded?.show;
        if (!show) continue;
        if (isReality(show.type, show.genres)) continue;
        const country = show.webChannel?.country?.name || show.network?.country?.name || "";
        if (isAnime(show.genres, show.language ?? "", country)) continue;
        if (!show.webChannel?.name) continue;
        const code = show.webChannel.country?.code || "";
        let region = regionFromLanguage(show.language ?? "", country);
        if (region === "english" && code === "GB") region = "british";
        if (!region) continue;
        const tt = show.externals?.imdb || "";
        const id = tt ? tt : `tvmaze-${show.id}-s${episode.season}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const date = episode.airdate;
        const channelName = show.webChannel.name;
        const platform =
          episode.season >= 1 ? `${channelName} · Season ${episode.season}` : channelName;
        const blurb =
          plain(show.summary) ||
          `${show.name} season ${episode.season} premieres on ${channelName}.`;
        const avgRating =
          typeof show.rating?.average === "number" && show.rating.average > 0
            ? show.rating.average.toFixed(1)
            : undefined;
        rows.push({
          id,
          title: show.name,
          week: date < iso(addDays(start, 7)) ? 1 : 2,
          weekday: weekdayIndex(date),
          day: dayLabel(date),
          kind: "series",
          region,
          place: "streaming",
          platform,
          blurb,
          imdb: tt ? `https://www.imdb.com/title/${tt}/` : undefined,
          rating: avgRating,
          poster: show.image?.original || episode.image?.original,
        });
      }
    }
  }
  return rows;
}

const omdbMemo = new Map<
  string,
  {
    Response?: string;
    Error?: string;
    Released?: string;
    Language?: string;
    Country?: string;
    Genre?: string;
    Plot?: string;
    Poster?: string;
    Type?: string;
    imdbRating?: string;
  } | null
>();

async function omdb(tt: string) {
  if (omdbMemo.has(tt)) return omdbMemo.get(tt) ?? null;
  const response = await fetch(
    `https://www.omdbapi.com/?apikey=trilogy&i=${tt}&plot=short`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as {
    Response?: string;
    Error?: string;
    Released?: string;
    Language?: string;
    Country?: string;
    Genre?: string;
    Plot?: string;
    Poster?: string;
    Type?: string;
    imdbRating?: string;
  };
  if (data.Response === "False") {
    return data.Error === "Request limit reached!" ? "limit" : null;
  }
  if (data.imdbRating && /^\d\.\d$/.test(data.imdbRating)) {
    primeRatingCache(tt, data.imdbRating);
  }
  omdbMemo.set(tt, data);
  return data;
}

async function fillPosters(releases: Release[]) {
  const need = releases.filter((item) => (!item.poster || !item.rating) && item.imdb);
  for (let index = 0; index < need.length; index += 8) {
    const chunk = need.slice(index, index + 8);
    await Promise.all(
      chunk.map(async (item) => {
        const tt = item.imdb?.match(/tt\d+/)?.[0];
        if (!tt) return;
        const meta = await omdb(tt).catch(() => null);
        if (!meta || meta === "limit") return;
        if (!item.poster && meta.Poster && meta.Poster !== "N/A") {
          item.poster = largerPoster(meta.Poster);
        }
        if (!item.rating && meta.imdbRating && /^\d\.\d$/.test(meta.imdbRating)) {
          item.rating = meta.imdbRating;
        }
      }),
    );
  }
  const missingTvmaze = releases.filter((item) => !item.poster && /^tvmaze-(\d+)/.test(item.id));
  await Promise.all(
    missingTvmaze.map(async (item) => {
      const maze = item.id.match(/^tvmaze-(\d+)/);
      if (!maze) return;
      try {
        const response = await fetch(`https://api.tvmaze.com/shows/${maze[1]}/images`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return;
        const images = (await response.json()) as {
          type?: string;
          resolutions?: { original?: { url?: string } };
        }[];
        const shot = images.find((image) => image.type === "poster") ?? images[0];
        const url = shot?.resolutions?.original?.url;
        if (url) item.poster = url;
      } catch {
        // Leave the letter tile if the show has no artwork.
      }
    }),
  );
}

async function rawImdbCalendars(userCountry: string) {
  return Promise.all([
    imdbCalendar(userCountry, "MOVIE").catch(() => [] as MovieHit[]),
    ...(["US", "GB", "IN"] as const).map((source) =>
      imdbCalendar(source, "TV").catch(() => [] as MovieHit[]),
    ),
  ]);
}

async function filmsFromCalendarGroups(
  groups: MovieHit[][],
  start: Date,
  end: Date,
  taken: Set<string>,
  userCountry: string,
) {
  const byId = new Map<string, MovieHit>();
  for (const hit of groups.flat()) {
    if (hit.date < iso(start) || hit.date > iso(end)) continue;
    if (taken.has(hit.tt)) continue;
    const existing = byId.get(hit.tt);
    if (!existing) {
      byId.set(hit.tt, hit);
      continue;
    }
    for (const source of hit.sources) existing.sources.add(source);
    if (!existing.poster && hit.poster) existing.poster = hit.poster;
    if (!existing.genres && hit.genres) existing.genres = hit.genres;
    existing.onMovie = existing.onMovie || hit.onMovie;
    existing.onTv = existing.onTv || hit.onTv;
  }

  const hits = [...byId.values()];
  const info = new Map<string, Awaited<ReturnType<typeof omdb>>>();
  let limited = false;
  for (let index = 0; index < hits.length; index += 8) {
    if (limited) break;
    const chunk = hits.slice(index, index + 8);
    const rows = await Promise.all(
      chunk.map(async (hit) => [hit.tt, await omdb(hit.tt).catch(() => null)] as const),
    );
    for (const [tt, row] of rows) {
      if (row === "limit") {
        limited = true;
        break;
      }
      info.set(tt, row);
    }
  }

  const releases: Release[] = [];
  for (const hit of hits) {
    const meta = info.get(hit.tt);
    const details = meta && meta !== "limit" ? meta : null;
    const genres = details?.Genre?.split(", ") ?? hit.genres;
    if (isReality(undefined, genres)) continue;
    if (isAnime(genres, details?.Language, details?.Country)) continue;
    const theatrical = hit.onMovie;
    let described = describeTitle(details?.Language, details?.Country);
    if (!theatrical) {
      if (described.region === "english" && hit.sources.size === 1 && hit.sources.has("GB")) {
        described = { region: "british", languageLabel: undefined };
      } else if (described.region === "local") {
        if (hit.sources.has("IN")) {
          described = { region: "hindi", languageLabel: undefined };
        } else if (hit.sources.has("US")) described = { region: "english", languageLabel: undefined };
        else if (hit.sources.has("GB") && !hit.sources.has("IN")) {
          described = { region: "british", languageLabel: undefined };
        } else continue;
      }
    } else if (described.region === "english" && userCountry === "GB") {
      described = { region: "british", languageLabel: undefined };
    }
    const plot = details?.Plot && details.Plot !== "N/A" ? details.Plot : "";
    const poster =
      hit.poster || (details?.Poster && details.Poster !== "N/A" ? largerPoster(details.Poster) : undefined);
    const rating =
      details?.imdbRating && /^\d\.\d$/.test(details.imdbRating) ? details.imdbRating : undefined;
    const tvMovie = !theatrical && details?.Type === "movie";
    const kind = theatrical || tvMovie ? "movie" : "series";
    const place = theatrical ? "cinema" : "streaming";
    releases.push({
      id: hit.tt,
      title: hit.title,
      week: hit.date < iso(addDays(start, 7)) ? 1 : 2,
      weekday: weekdayIndex(hit.date),
      day: dayLabel(hit.date),
      kind,
      region: described.region,
      languageLabel: described.languageLabel,
      place,
      platform: theatrical ? "Cinemas" : "Television",
      blurb:
        plot ||
        (theatrical
          ? "In cinemas this week."
          : kind === "movie"
            ? "Premieres on TV this week."
            : "New episode run this week."),
      imdb: `https://www.imdb.com/title/${hit.tt}/`,
      rating,
      poster,
    });
  }
  return releases;
}

const INDIAN: Record<string, Region> = {
  hindi: "hindi",
  tamil: "tamil",
  telugu: "telugu",
  malayalam: "malayalam",
  kannada: "kannada",
};

function longDate(text: string) {
  const match = text.match(/\b([A-Z][a-z]+) (\d{1,2}), (\d{4})\b/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]) + 1;
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function cleanCell(value: string) {
  return value
    .replace(/\*\*/g, "")
    .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseIndianTable(markdown: string) {
  const found: {
    title: string;
    kind: "movie" | "series";
    region: Region;
    platform: string;
    date: string;
  }[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.includes("|")) continue;
    const cells = line
      .split("|")
      .map((cell) => cleanCell(cell))
      .filter((cell) => cell && !/^-+$/.test(cell));
    if (cells.length < 5 || /^movie \/ series/i.test(cells[0])) continue;
    const date = longDate(cells[4]);
    const region = INDIAN[cells[2].toLowerCase()];
    if (!date || !region) continue;
    const kind = /series/i.test(cells[1]) ? "series" : /movie/i.test(cells[1]) ? "movie" : null;
    if (!kind) continue;
    found.push({
      title: cells[0].replace(/^[\s.]+/, ""),
      kind,
      region,
      platform: cells[3].split(",")[0].replace(/neftlix/i, "Netflix").trim(),
      date,
    });
  }
  return found;
}

export function parseIndianHeadings(markdown: string) {
  const found: {
    title: string;
    kind: "movie" | "series";
    region: Region;
    platform: string;
    date: string;
  }[] = [];
  let date: string | null = null;
  let current: { title: string; date: string; kind?: "movie" | "series"; region?: Region } | null =
    null;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^### (\d{1,2}) ([A-Z][a-z]+) (\d{4})/);
    if (heading) {
      date = longDate(`${heading[2]} ${heading[1]}, ${heading[3]}`);
      current = null;
      continue;
    }
    const title = line.match(/^#### \[(.+?)\]/);
    if (title && date) {
      current = { title: title[1], date };
      continue;
    }
    if (!current) continue;
    const meta = line.match(/(Series|Movie) · Original: ([A-Za-z]+)/);
    if (meta) {
      current.kind = /series/i.test(meta[1]) ? "series" : "movie";
      current.region = INDIAN[meta[2].toLowerCase()];
      continue;
    }
    const platform = line.match(/\*\*([^*]+)\*\*/);
    if (platform && current.kind && current.region) {
      found.push({
        title: current.title,
        kind: current.kind,
        region: current.region,
        platform: platform[1].trim(),
        date: current.date,
      });
      current = null;
    }
  }
  return found;
}

export function parseIndianHtmlPage(html: string) {
  const found: {
    title: string;
    kind: "movie" | "series";
    region: Region;
    platform: string;
    date: string;
  }[] = [];

  // 1. Parse HTML <table> rows directly from keralatv.in
  const trMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const tr of trMatches) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      plain(c[1]),
    );
    if (cells.length < 5 || /^movie \/ series/i.test(cells[0])) continue;
    const date = longDate(cells[4]);
    const region = INDIAN[cells[2].toLowerCase()];
    if (!date || !region) continue;
    const kind = /series/i.test(cells[1]) ? "series" : /movie/i.test(cells[1]) ? "movie" : null;
    if (!kind) continue;
    const rawTitle = cells[0].split("–")[0].replace(/^[\s.]+/, "").trim();
    if (!rawTitle) continue;
    found.push({
      title: rawTitle,
      kind,
      region,
      platform: cells[3].split(",")[0].replace(/neftlix/i, "Netflix").trim(),
      date,
    });
  }

  // 2. Parse <article class="am-ott-month-card"> cards directly from keralatv.in
  const cardMatches = html.matchAll(/<article[^>]*am-ott-month-card[^>]*>([\s\S]*?)<\/article>/gi);
  for (const card of cardMatches) {
    const body = card[1];
    const title = plain(
      body.match(/<h4[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ??
        body.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i)?.[1],
    );
    const meta = plain(body.match(/am-ott-month-meta[^>]*>([\s\S]*?)<\/div>/i)?.[1]);
    const metaParts = meta.match(/(Series|Movie)\s*·\s*Original:\s*([A-Za-z]+)/i);
    const platform = plain(body.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1]);
    const date = body.match(/data-month-date="(\d{4}-\d{2}-\d{2})"/i)?.[1] ?? null;
    if (!title || !metaParts || !platform || !date) continue;
    const kind = /series/i.test(metaParts[1]) ? "series" : "movie";
    const region = INDIAN[metaParts[2].toLowerCase()];
    if (!region) continue;
    found.push({
      title,
      kind,
      region,
      platform,
      date,
    });
  }

  return found;
}

type KeralaGuideItem = {
  id?: string;
  title?: string;
  type?: string;
  original_language?: string;
  season_label?: string;
  poster?: { url?: string };
  synopsis?: string;
  director?: string;
  cast?: string[];
  releases?: {
    platform_id?: string;
    status?: string;
    streaming_date?: string;
  }[];
};

async function fetchKeralaGuideJson(startIso: string, endIso: string) {
  const results: {
    title: string;
    kind: "movie" | "series";
    region: Region;
    platform: string;
    date: string;
    poster?: string;
    blurb?: string;
  }[] = [];

  let cursor = "";
  const seenCursors = new Set<string>();
  for (let pageNum = 0; pageNum < 8; pageNum += 1) {
    const url =
      "https://www.keralatv.in/wp-admin/admin-ajax.php?action=amt_full_guide&kind=titles" +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) break;
    const payload = (await response.json()) as {
      success?: boolean;
      data?: {
        items?: KeralaGuideItem[];
        page?: { next_cursor?: string };
      };
    };
    if (!payload.success || !payload.data?.items) break;

    for (const item of payload.data.items) {
      const title = item.title?.trim();
      if (!title) continue;
      const tType = (item.type ?? "").toLowerCase();
      if (tType === "realityshow" || tType === "shortfilm") continue;
      const kind: "movie" | "series" | null =
        tType === "series"
          ? "series"
          : tType === "movie" || tType === "documentary"
            ? "movie"
            : null;
      if (!kind) continue;

      const region = KERALA_LANG[(item.original_language ?? "").toLowerCase()];
      if (!region) continue;

      const matchingRel = (item.releases ?? []).find(
        (r) => r.streaming_date && r.streaming_date >= startIso && r.streaming_date <= endIso,
      );
      if (!matchingRel || !matchingRel.streaming_date) continue;

      const rawPlat = matchingRel.platform_id ?? "";
      const basePlatform = KERALA_PLATFORM[rawPlat] || rawPlat || "Streaming";
      const platform =
        kind === "series" && item.season_label && /^\d+$/.test(item.season_label)
          ? `${basePlatform} · Season ${item.season_label}`
          : basePlatform;

      let blurb = plain(item.synopsis);
      if (!blurb) {
        const castLine = Array.isArray(item.cast) && item.cast.length > 0
          ? ` Starring ${item.cast.slice(0, 3).join(", ")}.`
          : "";
        const dirLine = item.director ? ` Directed by ${item.director}.` : "";
        const langLabel = REGION_LABEL[region];
        blurb =
          kind === "series"
            ? `New ${langLabel} series, streaming on ${basePlatform}.${dirLine}${castLine}`
            : `${langLabel} film, streaming on ${basePlatform} this week.${dirLine}${castLine}`;
      }

      results.push({
        title,
        kind,
        region,
        platform,
        date: matchingRel.streaming_date,
        poster: item.poster?.url ? item.poster.url.replace(/\?wsr$/, "") : undefined,
        blurb,
      });
    }

    const nextCursor = payload.data.page?.next_cursor || "";
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return results;
}

function titleQueries(title: string) {
  const clean = title
    .replace(/[’‘]/g, "'")
    .replace(/^[\s.]+/, "")
    .replace(/\s+season\s+\d+\b/i, "")
    .trim();
  const queries = [clean];
  if (/sub-?inspector/i.test(clean)) queries.push(clean.replace(/sub-?inspector/i, "SI"));
  return [...new Set(queries)];
}

function suggestionScore(
  wanted: string,
  item: { l?: string; y?: string; id?: string; i?: { imageUrl?: string } },
) {
  if (!item.id?.startsWith("tt")) return -1;
  const left = wanted.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const right = (item.l ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!left || !right) return -1;
  let score = 0;
  if (left === right) score += 10;
  else if (right.includes(left) || left.includes(right)) score += 6;
  else {
    const words = new Set(left.split(" ").filter(Boolean));
    const hits = right.split(" ").filter((word) => words.has(word)).length;
    if (hits < Math.min(words.size, right.split(" ").filter(Boolean).length)) return -1;
    score += hits;
  }
  const year = Number(String(item.y ?? "").slice(0, 4));
  if (year >= 2025) score += 4;
  else if (year && year < 2024) score -= 3;
  if (item.i?.imageUrl) score += 1;
  return score;
}

async function matchImdb(title: string) {
  let best: { score: number; id: string; poster?: string } | null = null;
  for (const query of titleQueries(title)) {
    const key = query.toLowerCase().replace(/[^a-z0-9]/g, "")[0] || "a";
    try {
      const response = await fetch(
        `https://v3.sg.media-imdb.com/suggestion/${key}/${encodeURIComponent(query)}.json`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!response.ok) continue;
      const data = (await response.json()) as {
        d?: { l?: string; y?: string; id?: string; i?: { imageUrl?: string } }[];
      };
      for (const item of data.d ?? []) {
        const score = suggestionScore(query, item);
        if (score < 6 || (best && score <= best.score)) continue;
        best = { score, id: item.id!, poster: item.i?.imageUrl };
      }
    } catch {
      // Try the next spelling.
    }
  }
  return best;
}

async function indianOtt(start: Date, end: Date) {
  const startIso = iso(start);
  const endIso = iso(end);
  const slugs = [
    ...new Set([start, end].map((date) => `${MONTHS[date.getUTCMonth()].toLowerCase()}-${date.getUTCFullYear()}`)),
  ];

  // Fetch directly from keralatv.in JSON API + direct monthly HTML pages (0 Jina calls!)
  const [guideRows, htmlPages] = await Promise.all([
    fetchKeralaGuideJson(startIso, endIso).catch(() => []),
    Promise.all(
      slugs.map(async (slug) => {
        try {
          const res = await fetch(`https://www.keralatv.in/${slug}-ott-releases/`, {
            headers: { "user-agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(12000),
          });
          if (res.ok) return parseIndianHtmlPage(await res.text());
        } catch {
          // Fall back to Jina reader only if direct HTML fetch fails
        }
        try {
          const md = await readJinaText(`https://www.keralatv.in/${slug}-ott-releases/`);
          return [...parseIndianTable(md), ...parseIndianHeadings(md)];
        } catch {
          return [];
        }
      }),
    ),
  ]);

  const seen = new Set<string>();
  const releases: Release[] = [];

  const combined: {
    title: string;
    kind: "movie" | "series";
    region: Region;
    platform: string;
    date: string;
    poster?: string;
    blurb?: string;
  }[] = [...guideRows, ...htmlPages.flat()];

  for (const row of combined) {
    if (row.date < startIso || row.date > endIso) continue;
    const normKey = row.title
      .toLowerCase()
      .replace(/\s+season\s+\d+\b/i, "")
      .replace(/[^a-z0-9]+/g, "");
    if (!normKey || seen.has(normKey)) continue;
    seen.add(normKey);
    const language = REGION_LABEL[row.region];
    releases.push({
      id: `ott-${normKey}`,
      title: row.title,
      week: row.date < iso(addDays(start, 7)) ? 1 : 2,
      weekday: weekdayIndex(row.date),
      day: dayLabel(row.date),
      kind: row.kind,
      region: row.region,
      place: "streaming",
      platform: row.platform,
      poster: row.poster,
      blurb:
        row.blurb ||
        (row.kind === "series"
          ? `New ${language} series, streaming on ${row.platform}.`
          : `${language} film, streaming on ${row.platform} this week.`),
    });
  }

  for (let index = 0; index < releases.length; index += 6) {
    await Promise.all(
      releases.slice(index, index + 6).map(async (item) => {
        const match = await matchImdb(item.title);
        if (!match) return;
        item.id = match.id;
        item.imdb = `https://www.imdb.com/title/${match.id}/`;
        if (match.poster) item.poster = largerPoster(match.poster);
        const meta = await omdb(match.id).catch(() => null);
        if (meta && meta !== "limit") {
          if (meta.Poster && meta.Poster !== "N/A") item.poster = largerPoster(meta.Poster);
          if (
            meta.Plot &&
            meta.Plot !== "N/A" &&
            (item.blurb.startsWith("New ") || item.blurb.includes("streaming on "))
          ) {
            item.blurb = meta.Plot;
          }
          if (meta.imdbRating && /^\d\.\d$/.test(meta.imdbRating)) item.rating = meta.imdbRating;
        }
      }),
    );
  }
  return releases;
}

export async function buildCatalogue(
  now = new Date(),
  timeZone = "UTC",
  country = "US",
  forceRefresh = false,
): Promise<CatalogueResult> {
  const zone = safeTimeZone(timeZone);
  const userCountry = safeCountry(country);
  const { start, end, todayWeekday } = windowBounds(now, zone);
  const key = `${zone}:${userCountry}:${iso(start)}:v3`;
  const saved = cache.get(key);
  if (!forceRefresh && saved && Date.now() - saved.at < 3 * 60 * 60 * 1000) {
    return saved.data;
  }

  // Indian OTT (direct keralatv.in JSON/HTML) and TVMaze (direct JSON) do not use Jina,
  // while tvMoviePremieres and rawImdbCalendars share the throttled Jina pool (max 2 concurrent).
  const [series, indian, tvMovies, calendarGroups] = await Promise.all([
    streamingPremieres(start, end),
    indianOtt(start, end),
    tvMoviePremieres(start, end, userCountry),
    rawImdbCalendars(userCountry),
  ]);

  const taken = new Set(
    [...series, ...tvMovies, ...indian]
      .map((item) => item.imdb?.match(/tt\d+/)?.[0])
      .filter((id): id is string => Boolean(id)),
  );
  const films = await filmsFromCalendarGroups(calendarGroups, start, end, taken, userCountry);
  const names = new Set(
    [...series, ...tvMovies, ...films].map((item) =>
      item.title.toLowerCase().replace(/\s+season\s+\d+\b/i, "").trim(),
    ),
  );
  const dedupedIndian = indian.filter(
    (item) =>
      !names.has(item.title.toLowerCase().replace(/\s+season\s+\d+\b/i, "").trim()),
  );

  const releases = [...series, ...tvMovies, ...films, ...dedupedIndian].sort(
    (a, b) => a.week - b.week || a.weekday - b.weekday || a.title.localeCompare(b.title),
  );

  if (releases.length === 0) throw new Error("No releases found");
  await fillPosters(releases);

  const next = addDays(start, 7);
  const data: CatalogueResult = {
    releases,
    weeks: [
      { id: 1, label: weekLabel(start, addDays(start, 6)), hint: "This week" },
      { id: 2, label: weekLabel(next, end), hint: "Next week" },
    ],
    range: `${shortDay(start)} – ${shortDay(end)} ${end.getUTCFullYear()}`,
    zone: zoneLabel(zone, now),
    country: userCountry,
    countryName: countryName(userCountry),
    todayKey: `1-${todayWeekday}`,
    updatedAt: now.toISOString(),
  };

  // Only cache for the full TTL if Indian OTT releases also loaded
  if (indian.length > 0) {
    cache.set(key, { at: Date.now(), data });
  }
  return data;
}
