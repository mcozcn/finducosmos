import { describe, it, expect } from "vitest";
import { buildCaption, CORE_HASHTAGS } from "../src/caption.js";
import type { CarouselContent } from "../src/types.js";

const base: CarouselContent = { title: "t", slides: [], caption: "Gövde metni.", hashtags: ["#Satürn", "uzay", "space"] };

describe("buildCaption", () => {
  it("appends credit, source, follow line and normalized, deduped hashtags", () => {
    const c = buildCaption(base, { credit: "NASA/JPL-Caltech", sourceUrl: "https://images.nasa.gov/details/X", aiImage: false });
    expect(c.startsWith("Gövde metni.")).toBe(true);
    expect(c).toContain("📷 NASA/JPL-Caltech");
    expect(c).toContain("Kaynak: https://images.nasa.gov/details/X");
    expect(c).toContain("#Satürn");
    expect(c.match(/#uzay\b/g)).toHaveLength(1);
    expect(c).not.toContain("AI");
  });

  it("notes AI images", () => {
    expect(buildCaption(base, { credit: "NASA", sourceUrl: "u", aiImage: true })).toContain("Görsel yapay zekâ ile üretilmiştir");
  });

  it("caps hashtags at 30 and total length at 2200", () => {
    const many = { ...base, caption: "x".repeat(3000), hashtags: Array.from({ length: 50 }, (_, i) => `tag${i}`) };
    const c = buildCaption(many, { credit: "NASA", sourceUrl: "u", aiImage: false });
    expect(c.length).toBeLessThanOrEqual(2200);
    expect((c.match(/#\S+/g) ?? []).length).toBeLessThanOrEqual(30);
    expect(c).toContain("📷 NASA"); // credit survives truncation
  });

  it("keeps tag case, strips punctuation, dedupes case-insensitively", () => {
    const c = buildCaption({ ...base, hashtags: ["ISS", "black-hole", "#Satürn", "satürn"] }, { credit: "NASA", sourceUrl: "u", aiImage: false });
    expect(c).toContain("#ISS");
    expect(c).not.toContain("#ıss");
    expect(c).toContain("#blackhole");
    expect(c.match(/#satürn/gi)).toHaveLength(1);
    expect(c).toContain("#Satürn");
  });

  it("always includes the core hashtags", () => {
    const c = buildCaption({ ...base, hashtags: [] }, { credit: "NASA", sourceUrl: "u", aiImage: false });
    for (const h of CORE_HASHTAGS) expect(c).toContain(`#${h}`);
  });
});
