import { imageSize } from "image-size";
import type { Apod, NasaClient } from "./nasa.js";
import type { SourceMaterial, TopicChoice } from "./types.js";

const MIN_TEXT = 200;
const MIN_SHORT_EDGE = 1080;
const MAX_CANDIDATES = 10;

type SizeOf = (b: Buffer) => { width?: number; height?: number };

export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function bigEnough(buf: Buffer, sizeOf: SizeOf): boolean {
  const { width = 0, height = 0 } = sizeOf(buf);
  return Math.min(width, height) >= MIN_SHORT_EDGE;
}

function apodPageUrl(date: string): string {
  const [y, m, d] = date.split("-");
  return `https://apod.nasa.gov/apod/ap${y.slice(2)}${m}${d}.html`;
}

export async function findSource(
  topic: TopicChoice,
  deps: { nasa: NasaClient; apod: Apod | null; sizeOf?: SizeOf },
): Promise<SourceMaterial | null> {
  const sizeOf = deps.sizeOf ?? ((b: Buffer) => imageSize(b));

  if (topic.useApod && deps.apod) {
    const a = deps.apod;
    const img = await deps.nasa.download(a.hdurl ?? a.url);
    return {
      text: stripHtml(a.explanation),
      sourceUrl: apodPageUrl(a.date),
      credit: a.copyright ? `© ${a.copyright.replace(/\s+/g, " ").trim()}` : "NASA APOD",
      image: bigEnough(img, sizeOf) ? img : null,
    };
  }

  const items = (await deps.nasa.search(topic.searchQueryEn))
    .filter((it) => stripHtml(it.description).length >= MIN_TEXT)
    .slice(0, MAX_CANDIDATES);
  if (items.length === 0) return null;

  const toSource = (it: (typeof items)[number], image: Buffer | null): SourceMaterial => ({
    text: stripHtml(it.description),
    sourceUrl: `https://images.nasa.gov/details/${it.nasaId}`,
    credit: it.credit ?? (it.center ? `NASA/${it.center}` : "NASA"),
    image,
  });

  for (const it of items) {
    const urls = await deps.nasa.assetUrls(it.assetManifestUrl);
    const best = urls.find((u) => u.includes("~orig.jpg")) ?? urls.find((u) => u.includes("~large.jpg"));
    if (!best) continue;
    const img = await deps.nasa.download(best);
    if (bigEnough(img, sizeOf)) return toSource(it, img);
  }
  return toSource(items[0], null);
}
