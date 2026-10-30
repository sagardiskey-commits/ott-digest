const ratingCache = new Map<string, { at: number; score: string | null }>();
const RATING_TTL_MS = 6 * 60 * 60 * 1000;

export function isImdbId(value: string) {
  return /^tt\d+$/.test(value);
}

export function primeRatingCache(tt: string, score: string | null | undefined) {
  if (!isImdbId(tt) || score === undefined) return;
  ratingCache.set(tt, { at: Date.now(), score });
}

export function getCachedRating(tt: string): string | null | undefined {
  const cached = ratingCache.get(tt);
  if (cached && Date.now() - cached.at < RATING_TTL_MS) {
    return cached.score;
  }
  return undefined;
}
