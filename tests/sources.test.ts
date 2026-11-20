import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { findSource, stripHtml } from "../src/sources.js";
import { createNasaClient, type Apod, type NasaClient } from "../src/nasa.js";
import type { TopicChoice } from "../src/types.js";

const apod = JSON.parse(readFileSync("tests/fixtures/apod.json", "utf8")) as Apod;
const searchJson = JSON.parse(readFileSync("tests/fixtures/search.json", "utf8"));

// Minimal valid JPEG headers of a given size are awkward to hand-build, so fake image bytes via imageSize injection:
const bigJpeg = Buffer.from("big");
const smallJpeg = Buffer.from("small");
const sizeOf = (b: Buffer) => (b === bigJpeg ? { width: 2000, height: 1500 } : { width: 800, height: 600 });

function fakeNasa(over: Partial<NasaClient> = {}): NasaClient {
  return {
    apod: vi.fn(async () => apod),
    search: vi.fn(async () => createNasaClient("k", async () => new Response(JSON.stringify(searchJson))).search("x")),
    assetUrls: vi.fn(async () => ["https://x/a~orig.jpg", "https://x/a~large.jpg", "https://x/a~thumb.jpg"]),
    download: vi.fn(async () => bigJpeg),
    ...over,
  } as NasaClient;
}

const topic = (o: Partial<TopicChoice> = {}): TopicChoice =>
  ({ category: "solar_system", titleTr: "Satürn", searchQueryEn: "saturn rings", useApod: false, ...o });

describe("stripHtml", () => {
  it("removes tags and collapses whitespace", () => {
    expect(stripHtml("<p>Hello <b>world</b></p>\n\n x")).toBe("Hello world x");
  });
});

describe("findSource", () => {
  it("uses APOD when the topic says so", async () => {
    const nasa = fakeNasa();
    const s = await findSource(topic({ useApod: true, category: "apod" }), { nasa, apod, sizeOf });
    expect(s?.text).toContain("stellar nursery");
    expect(s?.credit).toBe("© Jane Astro");
    expect(s?.sourceUrl).toBe("https://apod.nasa.gov/apod/ap261120.html");
    expect(nasa.download).toHaveBeenCalledWith(apod.hdurl);
  });

  it("skips results whose description is under 200 chars and prefers ~orig", async () => {
    const nasa = fakeNasa();
    const s = await findSource(topic(), { nasa, apod: null, sizeOf });
    expect(s?.text.startsWith("Saturn's rings are made")).toBe(true);
    expect(s?.credit).toBe("NASA/JPL-Caltech/Space Science Institute");
    expect(s?.sourceUrl).toBe("https://images.nasa.gov/details/PIA21046");
    expect(nasa.download).toHaveBeenCalledWith("https://x/a~orig.jpg");
    expect(s?.image).toBe(bigJpeg);
  });

  it("keeps the text but returns image null when every image is too small", async () => {
    const nasa = fakeNasa({ download: vi.fn(async () => smallJpeg) });
    const s = await findSource(topic(), { nasa, apod: null, sizeOf });
    expect(s?.text).toContain("Saturn's rings");
    expect(s?.image).toBeNull();
  });

  it("returns null when no result has enough text", async () => {
    const nasa = fakeNasa({ search: vi.fn(async () => []) });
    expect(await findSource(topic(), { nasa, apod: null, sizeOf })).toBeNull();
  });
});

describe("findSource resilience", () => {
  const longDesc = "Saturn's rings are made mostly of water ice particles. ".repeat(5);
  const item = (id: string) => ({
    nasaId: id, title: id, description: longDesc, center: "JPL",
    credit: `credit ${id}`, assetManifestUrl: `https://x/${id}.json`,
  });
  const twoItems = vi.fn(async () => [item("A"), item("B")]);
  const assets = vi.fn(async (m: string) => [m.includes("/A.") ? "https://x/A~orig.jpg" : "https://x/B~orig.jpg"]);

  it("moves on to the next candidate when one download throws", async () => {
    const download = vi.fn(async (u: string) => {
      if (u.includes("A~")) throw new Error("HTTP 404");
      return bigJpeg;
    });
    const nasa = fakeNasa({ search: twoItems, assetUrls: assets, download });
    const s = await findSource(topic(), { nasa, apod: null, sizeOf });
    expect(s?.sourceUrl).toBe("https://images.nasa.gov/details/B");
    expect(s?.image).toBe(bigJpeg);
  });

  it("returns the first candidate's text with image null when every download throws", async () => {
    const download = vi.fn(async () => { throw new Error("truncated body"); });
    const nasa = fakeNasa({ search: twoItems, assetUrls: assets, download });
    const s = await findSource(topic(), { nasa, apod: null, sizeOf });
    expect(s?.sourceUrl).toBe("https://images.nasa.gov/details/A");
    expect(s?.text).toContain("Saturn's rings");
    expect(s?.image).toBeNull();
  });

  it("treats a sizeOf that throws as not big enough and moves on", async () => {
    const throwingSize = (b: Buffer) => {
      if (b === smallJpeg) throw new Error("unrecognised image");
      return sizeOf(b);
    };
    const download = vi.fn(async (u: string) => (u.includes("A~") ? smallJpeg : bigJpeg));
    const nasa = fakeNasa({ search: twoItems, assetUrls: assets, download });
    const s = await findSource(topic(), { nasa, apod: null, sizeOf: throwingSize });
    expect(s?.sourceUrl).toBe("https://images.nasa.gov/details/B");
    expect(s?.image).toBe(bigJpeg);
  });

  it("keeps APOD text with image null when the APOD download throws", async () => {
    const nasa = fakeNasa({ download: vi.fn(async () => { throw new Error("HTTP 500"); }) });
    const s = await findSource(topic({ useApod: true, category: "apod" }), { nasa, apod, sizeOf });
    expect(s?.text).toContain("stellar nursery");
    expect(s?.image).toBeNull();
  });

  it("skips a video APOD and uses the NASA Image Library search path", async () => {
    const nasa = fakeNasa();
    const videoApod = { ...apod, media_type: "video" };
    const s = await findSource(topic({ useApod: true, category: "apod" }), { nasa, apod: videoApod, sizeOf });
    expect(nasa.download).not.toHaveBeenCalledWith(apod.hdurl);
    expect(nasa.download).not.toHaveBeenCalledWith(apod.url);
    expect(nasa.search).toHaveBeenCalledWith("saturn rings");
    expect(s?.sourceUrl).toBe("https://images.nasa.gov/details/PIA21046");
  });
});
