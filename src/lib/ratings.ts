import { createServerFn } from "@tanstack/react-start";
import { readJinaText } from "./catalogue-build.ts";
import { getCachedRating, isImdbId, primeRatingCache } from "./rating-cache.ts";

export type LiveRatings = Record<string, string | null>;
export { primeRatingCache };

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
  const text = await readJinaText(`https://www.imdb.com/title/${tt}/`, 12000);
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
    ids: (data?.ids ?? []).filter(isImdbId).slice(0, 12),
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
