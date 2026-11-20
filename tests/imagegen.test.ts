import { describe, it, expect, vi } from "vitest";
import { generateFallbackImage } from "../src/imagegen.js";

describe("generateFallbackImage", () => {
  it("builds a no-text photoreal prompt from the topic and source", async () => {
    const generate = vi.fn(async (_prompt: string) => Buffer.from("img"));
    const out = await generateFallbackImage(
      { category: "black_holes", titleTr: "Olay ufku", searchQueryEn: "black hole event horizon", useApod: false },
      "A black hole is a region of spacetime where gravity is so strong that nothing can escape.",
      { generate },
    );
    expect(out.toString()).toBe("img");
    const prompt = generate.mock.calls[0][0] as string;
    expect(prompt).toContain("black hole event horizon");
    expect(prompt).toContain("no text");
    expect(prompt).toContain("4:5");
  });
});
