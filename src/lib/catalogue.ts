import { createServerFn } from "@tanstack/react-start";
import {
  buildCatalogue,
  safeCountry,
  safeTimeZone,
  type CatalogueResult,
} from "@/lib/catalogue-build";

export type { CatalogueResult };

export const getCatalogue = createServerFn({ method: "POST" })
  .validator((data: { timeZone?: string; country?: string }) => ({
    timeZone: safeTimeZone(data?.timeZone),
    country: safeCountry(data?.country),
  }))
  .handler(async ({ data }): Promise<CatalogueResult> =>
    buildCatalogue(new Date(), data.timeZone, data.country),
  );
