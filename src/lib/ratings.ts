import { createServerFn } from "@tanstack/react-start";

export type LiveRatings = Record<string, string | null>;

function imdbId(value: string) {
  return /^tt\d+$/.test(value);
}

async function readRating(tt: string): Promise<string | null> {
  const response = await fetch(
    `https://r.jina.ai/https://www.imdb.com/title/${tt}/`,
    {
      headers: { accept: "text/plain", "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15000),
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

/** Current IMDb scores for the given title ids. null means IMDb has no score. */
export const getLiveRatings = createServerFn({ method: "POST" })
  .validator((data: { ids: string[] }) => ({
    ids: (data?.ids ?? []).filter(imdbId).slice(0, 8),
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
