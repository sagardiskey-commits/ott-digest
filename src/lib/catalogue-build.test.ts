import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseCalendar,
  parseIndianHeadings,
  parseIndianTable,
  safeCountry,
  safeTimeZone,
  windowBounds,
} from "./catalogue-build.ts";

describe("catalogue-build helpers", () => {
  it("normalizes country and timeZone inputs safely", () => {
    assert.equal(safeCountry("au"), "AU");
    assert.equal(safeCountry("invalid"), "US");
    assert.equal(safeCountry(undefined), "US");

    assert.equal(safeTimeZone("Australia/Sydney"), "Australia/Sydney");
    assert.equal(safeTimeZone("Not/A_Zone"), "UTC");
    assert.equal(safeTimeZone(undefined), "UTC");
  });

  it("computes Monday-to-Sunday two-week windowBounds and todayWeekday", () => {
    // Friday 30 Oct 2026 in UTC
    const now = new Date("2026-10-30T10:00:00Z");
    const bounds = windowBounds(now, "UTC");
    assert.equal(bounds.start.toISOString().slice(0, 10), "2026-10-26");
    assert.equal(bounds.end.toISOString().slice(0, 10), "2026-11-08");
    assert.equal(bounds.todayWeekday, 4); // 0=Mon, 4=Fri
  });

  it("parses IMDb calendar markdown into MovieHits", () => {
    const sample = [
      "#### Oct 02, 2026",
      "![](https://m.media-amazon.com/images/M/MV5BTEST._V1_QL75_UX140_.jpg)",
      "[Digger (2026)](https://www.imdb.com/title/tt31450459/?ref_=rlm)",
    ].join("\n");

    const hits = parseCalendar(sample, "AU", "movie");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].tt, "tt31450459");
    assert.equal(hits[0].title, "Digger");
    assert.equal(hits[0].date, "2026-10-02");
    assert.equal(
      hits[0].poster,
      "https://m.media-amazon.com/images/M/MV5BTEST._V1_SX400.jpg",
    );
    assert.equal(hits[0].onMovie, true);
  });

  it("parses Indian OTT tables and headings", () => {
    const tableMd = [
      "| Movie / Series | Type | Language | OTT Platform | Release Date |",
      "| --- | --- | --- | --- | --- |",
      "| **Sardar 2** | Movie | Tamil | Prime Video | October 1, 2026 |",
      "| Dupahiya | Web Series | Hindi | Neftlix | October 2, 2026 |",
    ].join("\n");

    const tableRows = parseIndianTable(tableMd);
    assert.equal(tableRows.length, 2);
    assert.deepEqual(tableRows[0], {
      title: "Sardar 2",
      kind: "movie",
      region: "tamil",
      platform: "Prime Video",
      date: "2026-10-01",
    });
    assert.equal(tableRows[1].platform, "Netflix");

    const headingMd = [
      "### 2 October 2026",
      "#### [Bethlehem Kudumba Unit](https://example.com)",
      "Movie · Original: Malayalam",
      "Streaming on **JioHotstar**",
    ].join("\n");

    const headingRows = parseIndianHeadings(headingMd);
    assert.equal(headingRows.length, 1);
    assert.deepEqual(headingRows[0], {
      title: "Bethlehem Kudumba Unit",
      kind: "movie",
      region: "malayalam",
      platform: "JioHotstar",
      date: "2026-10-02",
    });
  });
});
