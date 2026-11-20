import { describe, it, expect, vi } from "vitest";
import { writeCarousel, writeVerifiedCarousel } from "../src/write.js";
import type { CarouselContent, SourceMaterial, TopicChoice } from "../src/types.js";

const topic: TopicChoice = { category: "solar_system", titleTr: "Satürn'ün halkaları", searchQueryEn: "saturn rings", useApod: false };
const source: SourceMaterial = { text: "Saturn's rings are made of ice.", sourceUrl: "u", credit: "NASA", image: null };
const good: CarouselContent = {
  title: "Satürn'ün halkaları *yavaşça* yok oluyor",
  slides: [{ body: "Halkalar buzdan oluşur." }, { body: "Buz Satürn'e yağıyor." }],
  caption: "Satürn hakkında.", hashtags: ["uzay", "saturn"],
};

describe("writeCarousel", () => {
  it("sends source text and grounding rule; passes feedback on rewrite", async () => {
    const ask = vi.fn(async (_args: any) => good);
    await writeCarousel({ askJson: ask as any, topic, source, feedback: ["Buz Satürn'e yağıyor."] });
    const { system, user } = ask.mock.calls[0][0] as any;
    expect(system).toContain("ONLY");
    expect(user).toContain("Saturn's rings are made of ice.");
    expect(user).toContain("Buz Satürn'e yağıyor.");
  });

  it("rejects slide counts outside 2-3 and bodies over 180 chars", async () => {
    const one = vi.fn(async (_args: any) => ({ ...good, slides: [{ body: "a" }] }));
    await expect(writeCarousel({ askJson: one as any, topic, source })).rejects.toThrow("2-3 slides");
    const long = vi.fn(async (_args: any) => ({ ...good, slides: [{ body: "a".repeat(181) }, { body: "b" }] }));
    await expect(writeCarousel({ askJson: long as any, topic, source })).rejects.toThrow("180");
  });
});

describe("writeVerifiedCarousel", () => {
  it("returns content when verification passes first time", async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce(good)
      .mockResolvedValueOnce({ supported: true, unsupported: [] });
    await expect(writeVerifiedCarousel({ askJson: ask as any, topic, source })).resolves.toEqual(good);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("rewrites once with feedback, then succeeds", async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce(good)
      .mockResolvedValueOnce({ supported: false, unsupported: ["Buz Satürn'e yağıyor."] })
      .mockResolvedValueOnce(good)
      .mockResolvedValueOnce({ supported: true, unsupported: [] });
    await writeVerifiedCarousel({ askJson: ask as any, topic, source });
    expect((ask.mock.calls[2][0] as any).user).toContain("Buz Satürn'e yağıyor.");
  });

  it("throws when verification fails twice", async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce(good)
      .mockResolvedValueOnce({ supported: false, unsupported: ["x"] })
      .mockResolvedValueOnce(good)
      .mockResolvedValueOnce({ supported: false, unsupported: ["y"] });
    await expect(writeVerifiedCarousel({ askJson: ask as any, topic, source })).rejects.toThrow("failed fact verification");
  });
});
