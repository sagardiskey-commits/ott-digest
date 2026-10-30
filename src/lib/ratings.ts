import { createServerFn } from "@tanstack/react-start";
import { getCachedRating, isImdbId, primeRatingCache } from "./rating-cache.ts";

export type LiveRatings = Record<string, string | null>;
export { primeRatingCache };

async function readRatingFromImdbHtml(tt: string): Promise<string | null | undefined> {
  try {
    const response = await fetch(`https://www.imdb.com/title/${tt}/`, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return undefined;
    const html = await response.text();
    const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    if (ldMatch) {
      const parsed = JSON.parse(ldMatch[1]) as {
        aggregateRating?: { ratingValue?: number | string };
      };
      const val = parsed?.aggregateRating?.ratingValue;
      if (val !== undefined && val !== null) {
        return Number(val).toFixed(1);
      }
      return null;
    }
  } catch {
    // Fall through to OMDb / Jina fallback.
  }
  return undefined;
}

async function readRatingFromOmdb(tt: string): Promise<string | null | undefined> {
  try {
    const response = await fetch(
      `https://www.omdbapi.com/?apikey=trilogy&i=${tt}&plot=short`,
      { signal: AbortSignal.timeout(7000) },
    );
    if (!response.ok) return undefined;
    const data = (await response.json()) as {
      Response?: string;
      imdbRating?: string;
    };
    if (data.Response === "False") return undefined;
    if (data.imdbRating && /^\d\.\d$/.test(data.imdbRating)) {
      return data.imdbRating;
    }
    if (data.imdbRating === "N/A") return null;
  } catch {
    // Fall through to Jina fallback.
  }
  return undefined;
}

async function readRatingFromJina(tt: string): Promise<string | null> {
  const response = await fetch(
    `https://r.jina.ai/https://www.imdb.com/title/${tt}/`,
    {
      headers: { accept: "text/plain", "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(12000),
    },
  );
  if (!response.ok) throw new Error(String(response.status));
  const text = await response.text();
  const title = text.match(/^Title:\s*(.+)$/m)?.[1] ?? "";
  const score = title.match(/⭐\s*(\d\.\d)/);
  if (score) return score[1];
  if (title.length > 0) return null;
  throw new Error("empty");
}

async function readRating(tt: string): Promise<string | null> {
  const cached = getCachedRating(tt);
  if (cached !== undefined) {
    return cached;
  }

  const fromHtml = await readRatingFromImdbHtml(tt);
  if (fromHtml !== undefined) {
    primeRatingCache(tt, fromHtml);
    return fromHtml;
  }

  const fromOmdb = await readRatingFromOmdb(tt);
  if (fromOmdb !== undefined) {
    primeRatingCache(tt, fromOmdb);
    return fromOmdb;
  }

  const fromJina = await readRatingFromJina(tt);
  primeRatingCache(tt, fromJina);
  return fromJina;
}

/** Current IMDb scores for the given title ids. null means IMDb has no score. */
export const getLiveRatings = createServerFn({ method: "POST" })
  .validator((data: { ids: string[] }) => ({
    ids: (data?.ids ?? []).filter(isImdbId).slice(0, 16),
  }))
  .handler(async ({ data }): Promise<LiveRatings> => {
    const ratings: LiveRatings = {};
    await Promise.all(
      data.ids.map(async (tt) => {
        try {
          ratings[tt] = await readRating(tt);
        } catch {
          // Leave it out so the page can keep the last saved score.
        }
      }),
    );
    return ratings;
  });
