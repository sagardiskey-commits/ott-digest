import { REGION_LABEL, type Region, type Release } from "@/data/releases";

export type WeekBand = { id: 1 | 2; label: string; hint: string };

export type CatalogueResult = {
  releases: Release[];
  weeks: WeekBand[];
  range: string;
  zone: string;
  country: string;
  countryName: string;
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

type MovieHit = {
  tt: string;
  title: string;
  date: string;
  poster?: string;
  sources: Set<string>;
  onMovie: boolean;
  onTv: boolean;
};

const cache = new Map<string, { at: number; data: CatalogueResult }>();

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

function windowBounds(now: Date, timeZone: string) {
  const { year, month, day } = localDateParts(now, timeZone);
  const today = new Date(Date.UTC(year, month - 1, day));
  const dow = today.getUTCDay();
  const start = new Date(today);
  start.setUTCDate(today.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 13);
  return { start, end };
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
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
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
  return { region: "local" as const, languageLabel: first || origin || undefined };
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
  return (genres ?? []).some((genre) => /reality/i.test(genre));
}

async function readText(url: string) {
  const response = await fetch(url, {
    headers: { accept: "text/plain", "user-agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.text();
}

function parseCalendar(markdown: string, source: string, kind: "movie" | "series") {
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
  const markdown = await readText(
    `https://r.jina.ai/https://www.imdb.com/calendar/?region=${source}&type=${type}`,
  );
  return parseCalendar(markdown, source, type === "MOVIE" ? "movie" : "series");
}

function looseDate(text: string) {
  const match = text.match(/\b([A-Z][a-z]{2}) (\d{1,2}), (\d{4})\b/);
  if (!match) return null;
  const month = MONTH_INDEX[match[1]];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function regionForCountry(code: string) {
  if (code === "GB") return { region: "british" as const, languageLabel: undefined };
  if (code === "US" || code === "AU" || code === "CA" || code === "NZ" || code === "IE") {
    return { region: "english" as const, languageLabel: undefined };
  }
  if (code === "IN") return { region: "hindi" as const, languageLabel: undefined };
  return { region: "local" as const, languageLabel: countryName(code) };
}

function parseTvMovies(markdown: string) {
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
    if (current?.tv && !current.anime && current.date) found.push(current);
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
    const released = line.match(/Releases ([A-Z][a-z]{2} \d{1,2}, \d{4})/);
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
  const pages = await Promise.all([
    ...countries.map(async (code) => {
      try {
        const markdown = await readText(
          `https://r.jina.ai/https://www.imdb.com/search/title/?title_type=tv_movie&release_date=${iso(start)},${iso(end)}&sort=release_date,asc&countries=${code}`,
        );
        return parseTvMovies(markdown).map((item) => ({ ...item, code }));
      } catch {
        return [];
      }
    }),
    readText(
      `https://r.jina.ai/https://www.imdb.com/search/title/?title_type=tv_movie&release_date=${iso(start)},${iso(end)}&sort=release_date,asc`,
    )
      .then((markdown) => parseTvMovies(markdown).map((item) => ({ ...item, code: "" })))
      .catch(() => []),
  ]);
  const seen = new Set<string>();
  const releases: Release[] = [];
  for (const item of pages.flat()) {
    if (seen.has(item.tt)) continue;
    if (item.date < iso(start) || item.date > iso(end)) continue;
    seen.add(item.tt);
    const described = item.code
      ? regionForCountry(item.code)
      : { region: "local" as const, languageLabel: undefined };
    releases.push({
      id: item.tt,
      title: item.title,
      week: item.date < iso(addDays(start, 7)) ? 1 : 2,
      weekday: weekdayIndex(item.date),
      day: dayLabel(item.date),
      kind: "movie",
      region: described.region,
      languageLabel: described.languageLabel,
      place: "streaming",
      platform: "Television",
      blurb: item.blurb || "Premieres on TV this week.",
      imdb: `https://www.imdb.com/title/${item.tt}/`,
      poster: item.poster,
    });
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
  image: { original?: string } | null;
  network: { name: string; country?: { code?: string; name?: string } | null } | null;
  webChannel: { name: string; country?: { code?: string; name?: string } | null } | null;
  externals?: { imdb?: string | null };
};

async function streamingPremieres(start: Date, end: Date) {
  const days: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    days.push(iso(cursor));
  }
  const rows: Release[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < days.length; index += 7) {
    const chunk = days.slice(index, index + 7);
    const lists = await Promise.all(
      chunk.map(async (date) => {
        const response = await fetch(`https://api.tvmaze.com/schedule/web?date=${date}`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) return [];
        return (await response.json()) as {
          season: number;
          number: number;
          airdate: string;
          image: { original?: string } | null;
          _embedded?: { show?: MazeShow };
        }[];
      }),
    );
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
        const platform = show.webChannel.name;
        const blurb =
          plain(show.summary) ||
          `${show.name} season ${episode.season} premieres on ${platform}.`;
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
          poster: show.image?.original || episode.image?.original,
        });
      }
    }
  }
  return rows;
}

async function omdb(tt: string) {
  const response = await fetch(
    `https://www.omdbapi.com/?apikey=trilogy&i=${tt}&plot=short`,
    { signal: AbortSignal.timeout(12000) },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as {
    Response?: string;
    Error?: string;
    Language?: string;
    Country?: string;
    Genre?: string;
    Plot?: string;
    Poster?: string;
    Type?: string;
  };
  if (data.Response === "False") return data.Error === "Request limit reached!" ? "limit" : null;
  return data;
}

async function fillPosters(releases: Release[]) {
  const need = releases.filter((item) => !item.poster && item.imdb);
  for (let index = 0; index < need.length; index += 6) {
    const chunk = need.slice(index, index + 6);
    await Promise.all(
      chunk.map(async (item) => {
        const tt = item.imdb?.match(/tt\d+/)?.[0];
        if (!tt) return;
        const meta = await omdb(tt).catch(() => null);
        if (!meta || meta === "limit") return;
        if (meta.Poster && meta.Poster !== "N/A") item.poster = largerPoster(meta.Poster);
      }),
    );
  }
  for (const item of releases) {
    if (item.poster) continue;
    const maze = item.id.match(/^tvmaze-(\d+)/);
    if (!maze) continue;
    try {
      const response = await fetch(`https://api.tvmaze.com/shows/${maze[1]}/images`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) continue;
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
  }
}

async function filmsFromCalendars(start: Date, end: Date, taken: Set<string>, userCountry: string) {
  const groups = await Promise.all([
    imdbCalendar(userCountry, "MOVIE").catch(() => [] as MovieHit[]),
    ...(["US", "GB", "IN"] as const).map((source) =>
      imdbCalendar(source, "TV").catch(() => [] as MovieHit[]),
    ),
  ]);
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
    existing.onMovie = existing.onMovie || hit.onMovie;
    existing.onTv = existing.onTv || hit.onTv;
  }

  const hits = [...byId.values()];
  const info = new Map<string, Awaited<ReturnType<typeof omdb>>>();
  let limited = false;
  for (let index = 0; index < hits.length; index += 6) {
    if (limited) break;
    const chunk = hits.slice(index, index + 6);
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
    if (isReality(undefined, details?.Genre?.split(", "))) continue;
    if (isAnime(details?.Genre?.split(", "), details?.Language, details?.Country)) continue;
    const theatrical = hit.onMovie;
    let described = describeTitle(details?.Language, details?.Country);
    if (!theatrical) {
      if (described.region === "english" && hit.sources.size === 1 && hit.sources.has("GB")) {
        described = { region: "british", languageLabel: undefined };
      } else if (described.region === "local") {
        if (hit.sources.has("IN")) {
          described = { region: "local", languageLabel: "India" };
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
      hit.poster || (details?.Poster && details.Poster !== "N/A" ? details.Poster : undefined);
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
        (theatrical ? "In cinemas this week." : kind === "movie" ? "Premieres on TV this week." : "New episode run this week."),
      imdb: `https://www.imdb.com/title/${hit.tt}/`,
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

function parseIndianTable(markdown: string) {
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

function parseIndianHeadings(markdown: string) {
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
        { signal: AbortSignal.timeout(12000) },
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

function pageSynopsis(text: string) {
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find(
      (part) =>
        part.length > 70 &&
        !part.startsWith("[") &&
        !part.startsWith("!") &&
        !part.startsWith("#") &&
        !part.startsWith("*") &&
        !part.includes("ref_=") &&
        !/sign in|watchlist|site index|advertising/i.test(part),
    );
  if (!line) return "";
  const repeated = line.indexOf(line.slice(0, 48), 48);
  const once = (repeated > 40 ? line.slice(0, repeated) : line).trim();
  return once.replace(/^[^:]{0,80}:\s*/, "").trim();
}

async function describeFromImdb(tt: string) {
  try {
    const text = await readText(`https://r.jina.ai/https://www.imdb.com/title/${tt}/`);
    const image = text.match(/\((https:\/\/m\.media-amazon\.com\/images\/M\/[^)]+)\)/);
    return { blurb: pageSynopsis(text), poster: image ? largerPoster(image[1]) : undefined };
  } catch {
    return { blurb: "", poster: undefined };
  }
}

async function indianOtt(start: Date, end: Date) {
  const slugs = [
    ...new Set([start, end].map((date) => `${MONTHS[date.getUTCMonth()].toLowerCase()}-${date.getUTCFullYear()}`)),
  ];
  const pages = await Promise.all(
    slugs.map((slug) =>
      readText(`https://r.jina.ai/https://www.keralatv.in/${slug}-ott-releases/`).catch(() => ""),
    ),
  );
  const seen = new Set<string>();
  const releases: Release[] = [];
  for (const row of pages.flatMap((page) => [...parseIndianTable(page), ...parseIndianHeadings(page)])) {
    if (row.date < iso(start) || row.date > iso(end)) continue;
    const key = row.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const language = REGION_LABEL[row.region];
    releases.push({
      id: `ott-${key.replace(/[^a-z0-9]+/g, "-")}`,
      title: row.title,
      week: row.date < iso(addDays(start, 7)) ? 1 : 2,
      weekday: weekdayIndex(row.date),
      day: dayLabel(row.date),
      kind: row.kind,
      region: row.region,
      place: "streaming",
      platform: row.platform,
      blurb:
        row.kind === "series"
          ? `New ${language} series, streaming on ${row.platform}.`
          : `${language} film, streaming on ${row.platform} this week.`,
    });
  }
  for (let index = 0; index < releases.length; index += 4) {
    await Promise.all(
      releases.slice(index, index + 4).map(async (item) => {
        const match = await matchImdb(item.title);
        if (!match) return;
        item.id = match.id;
        item.imdb = `https://www.imdb.com/title/${match.id}/`;
        if (match.poster) item.poster = largerPoster(match.poster);
        const meta = await omdb(match.id).catch(() => null);
        if (meta && meta !== "limit") {
          if (meta.Poster && meta.Poster !== "N/A") item.poster = largerPoster(meta.Poster);
          if (meta.Plot && meta.Plot !== "N/A") item.blurb = meta.Plot;
        }
        if (item.poster && !item.blurb.startsWith("New ") && !item.blurb.endsWith("this week.")) return;
        const page = await describeFromImdb(match.id);
        if (!item.poster && page.poster) item.poster = page.poster;
        if (page.blurb) item.blurb = page.blurb;
      }),
    );
  }
  return releases;
}

export async function buildCatalogue(
  now = new Date(),
  timeZone = "UTC",
  country = "US",
): Promise<CatalogueResult> {
  const zone = safeTimeZone(timeZone);
  const userCountry = safeCountry(country);
  const { start, end } = windowBounds(now, zone);
  const key = `${zone}:${userCountry}:${iso(start)}:indian-art`;
  const saved = cache.get(key);
  if (saved && Date.now() - saved.at < 3 * 60 * 60 * 1000) {
    return saved.data;
  }

  const series = await streamingPremieres(start, end);
  const tvMovies = await tvMoviePremieres(start, end, userCountry);
  const taken = new Set(
    [...series, ...tvMovies]
      .map((item) => item.imdb?.match(/tt\d+/)?.[0])
      .filter((id): id is string => Boolean(id)),
  );
  const films = await filmsFromCalendars(start, end, taken, userCountry);
  const indian = await indianOtt(start, end);
  const names = new Set(
    [...series, ...tvMovies, ...films].map((item) => item.title.toLowerCase()),
  );
  const releases = [...series, ...tvMovies, ...films, ...indian.filter((item) => !names.has(item.title.toLowerCase()))].sort((a, b) =>
    a.week - b.week || a.weekday - b.weekday || a.title.localeCompare(b.title),
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
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}
