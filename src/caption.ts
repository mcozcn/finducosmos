import { ACCOUNT_HANDLE } from "./config.js";
import type { CarouselContent } from "./types.js";

export const CORE_HASHTAGS = ["uzay", "astronomi", "space", "nasa", "evren"];
const MAX_CAPTION = 2200;
const MAX_TAGS = 30;

const normTag = (t: string) => t.replace(/[^\p{L}\p{N}_]/gu, "");

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags.filter((t) => {
    const key = t.toLocaleLowerCase("tr");
    if (!t || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildCaption(
  content: CarouselContent,
  meta: { credit: string; sourceUrl: string; aiImage: boolean },
): string {
  const tags = dedupeTags([...CORE_HASHTAGS, ...content.hashtags].map(normTag)).slice(0, MAX_TAGS);
  const footer = [
    "",
    `📷 ${meta.credit}`,
    ...(meta.aiImage ? ["Görsel yapay zekâ ile üretilmiştir; bilgiler NASA kaynağındandır."] : []),
    `Kaynak: ${meta.sourceUrl}`,
    `Kaydet & takip et → ${ACCOUNT_HANDLE}`,
    "",
    tags.map((t) => `#${t}`).join(" "),
  ].join("\n");
  const room = MAX_CAPTION - footer.length;
  const body = content.caption.length > room ? content.caption.slice(0, room - 1).trimEnd() + "…" : content.caption;
  return body + footer;
}
