import { describe, it, expect, vi } from "vitest";
import { pickTopic } from "../src/topic.js";
import type { AskJson } from "../src/claude.js";

const fakeAsk = (result: unknown) => vi.fn(async () => result) as unknown as AskJson & ReturnType<typeof vi.fn>;

describe("pickTopic", () => {
  it("returns the model's choice when it respects the rules", async () => {
    const ask = fakeAsk({ category: "black_holes", titleTr: "Olay ufku", searchQueryEn: "black hole event horizon", useApod: false });
    const t = await pickTopic({ askJson: ask, recent: ["Satürn"], last: "solar_system", apodTitle: null });
    expect(t.category).toBe("black_holes");
  });

  it("puts recent titles, last category and APOD title into the prompt", async () => {
    const ask = fakeAsk({ category: "apod", titleTr: "Orion", searchQueryEn: "orion nebula", useApod: true });
    await pickTopic({ askJson: ask, recent: ["Satürn", "Mars"], last: "scale", apodTitle: "The Orion Nebula" });
    const { user } = (ask as any).mock.calls[0][0];
    expect(user).toContain("Satürn");
    expect(user).toContain("Mars");
    expect(user).toContain("scale");
    expect(user).toContain("The Orion Nebula");
  });

  it("rejects a repeated category", async () => {
    const ask = fakeAsk({ category: "scale", titleTr: "x", searchQueryEn: "x", useApod: false });
    await expect(pickTopic({ askJson: ask, recent: [], last: "scale", apodTitle: null })).rejects.toThrow("same category");
  });

  it("rejects a repeated title (case-insensitive)", async () => {
    const ask = fakeAsk({ category: "scale", titleTr: "satürn", searchQueryEn: "x", useApod: false });
    await expect(pickTopic({ askJson: ask, recent: ["Satürn"], last: null, apodTitle: null })).rejects.toThrow("repeats");
  });

  it("rejects useApod when there is no image APOD today", async () => {
    const ask = fakeAsk({ category: "apod", titleTr: "x", searchQueryEn: "x", useApod: true });
    await expect(pickTopic({ askJson: ask, recent: [], last: null, apodTitle: null })).rejects.toThrow("APOD");
  });
});
