import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { slideHtml, type RenderInput } from "./editorial.js";

export async function renderCarousel(input: RenderInput, outDir: string): Promise<string[]> {
  const dir = resolve(outDir);
  const htmlDir = join(dir, "html");
  await mkdir(htmlDir, { recursive: true });
  await writeFile(join(htmlDir, "bg.jpg"), input.image);

  const kinds: ("cover" | "info" | "closing")[] = ["cover", ...input.content.slides.map(() => "info" as const), "closing"];
  const total = kinds.length;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    const out: string[] = [];
    for (let i = 0; i < total; i++) {
      const htmlPath = join(htmlDir, `${String(i + 1).padStart(2, "0")}.html`);
      await writeFile(htmlPath, slideHtml(kinds[i], input, i, total), "utf8");
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const jpg = join(dir, `${String(i + 1).padStart(2, "0")}.jpg`);
      await page.screenshot({ path: jpg, type: "jpeg", quality: 90, clip: { x: 0, y: 0, width: 1080, height: 1350 } });
      out.push(jpg);
    }
    return out;
  } finally {
    await browser.close();
  }
}
