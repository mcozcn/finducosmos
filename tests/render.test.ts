import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageSize } from "image-size";
import { escapeHtml, emphasize, slideHtml, type RenderInput } from "../src/render/editorial.js";
import { renderCarousel } from "../src/render/render.js";

// 1x1 JPEG
const PIXEL = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

const input: RenderInput = {
  content: {
    title: "Satürn'ün halkaları *yavaşça* yok oluyor",
    slides: [{ body: "Halkalar milyarlarca buz parçasından oluşur." }, { heading: "Buz yağmuru", body: "Parçalar gezegene doğru yağar." }],
    caption: "c", hashtags: [],
  },
  category: "solar_system",
  credit: "NASA/JPL-Caltech",
  image: PIXEL,
  aiImage: true,
};

describe("editorial html", () => {
  it("escapes html and turns *word* into an accent em", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
    expect(emphasize("bir *iki* üç")).toBe("bir <em>iki</em> üç");
    expect(emphasize("<b>*x*</b>")).toBe("&lt;b&gt;<em>x</em>&lt;/b&gt;");
  });

  it("cover shows headline, counter, category and AI badge", () => {
    const h = slideHtml("cover", input, 0, 4);
    expect(h).toContain("<em>yavaşça</em>");
    expect(h).toContain("01 / 04");
    expect(h).toContain("Güneş Sistemi");
    expect(h).toContain("AI görseli");
  });

  it("info slide uses roman numerals", () => {
    expect(slideHtml("info", input, 2, 4)).toContain("ii.");
  });

  it("long info bodies use the smaller body class", () => {
    const long = { ...input, content: { ...input.content, slides: [{ heading: "H", body: "a".repeat(180) }] } };
    expect(slideHtml("info", long, 1, 3)).toContain('class="body long"');
    expect(slideHtml("info", input, 1, 4)).toContain('class="body"');
  });

  it("credit footers use a text label, not an emoji", () => {
    for (const kind of ["info", "closing"] as const) {
      const h = slideHtml(kind, input, 1, 4);
      expect(h).toContain("Görsel: NASA/JPL-Caltech");
      expect(h).not.toContain("📷");
    }
  });
});

describe("renderCarousel", () => {
  it("renders cover + info slides + closing as 1080x1350 JPEGs under 8MB", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fc-render-"));
    const files = await renderCarousel(input, dir);
    expect(files.map((f) => f.split("/").pop())).toEqual(["01.jpg", "02.jpg", "03.jpg", "04.jpg"]);
    for (const f of files) {
      const buf = await readFile(f);
      expect(imageSize(buf)).toMatchObject({ width: 1080, height: 1350, type: "jpg" });
      expect((await stat(f)).size).toBeLessThan(8 * 1024 * 1024);
    }
  }, 60_000);
});
