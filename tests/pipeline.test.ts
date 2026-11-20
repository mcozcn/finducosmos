import { describe, it, expect, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDailyPipeline, type PipelineDeps } from "../src/pipeline.js";

const NOW = new Date("2026-11-21T16:00:00Z"); // 19:00 Istanbul
const content = { title: "Başlık *x*", slides: [{ body: "a" }, { body: "b" }], caption: "c", hashtags: ["uzay"] };

async function deps(over: Partial<PipelineDeps> = {}): Promise<PipelineDeps & { root: string }> {
  const root = await mkdtemp(join(tmpdir(), "fc-pipe-"));
  await writeFile(join(root, "history.json"), "[]");
  let topicCalls = 0;
  const askJson = vi.fn(async ({ schema }: any) => {
    const keys = Object.keys(schema.shape);
    if (keys.includes("searchQueryEn")) {
      topicCalls++;
      return { category: "solar_system", titleTr: `Satürn ${topicCalls}`, searchQueryEn: "saturn", useApod: false };
    }
    if (keys.includes("slides")) return content;
    return { supported: true, unsupported: [] };
  });
  return {
    askJson: askJson as any,
    nasa: {
      apod: vi.fn(async () => ({ date: "2026-11-21", title: "Vid", explanation: "", url: "u", media_type: "video" })),
      search: vi.fn(async () => [{ nasaId: "N1", title: "t", description: "x".repeat(250), center: "JPL", assetManifestUrl: "m" }]),
      assetUrls: vi.fn(async () => ["https://x/a~orig.jpg"]),
      download: vi.fn(async () => Buffer.from("img")),
    },
    sizeOf: () => ({ width: 2000, height: 2000 }),
    imageModel: { generate: vi.fn(async () => Buffer.from("ai")) },
    instagram: { publishCarousel: vi.fn(async () => ({ mediaId: "M1", permalink: "https://ig/p" })), refreshToken: vi.fn() },
    render: vi.fn(async (_i: any, dir: string) => [join(dir, "01.jpg"), join(dir, "02.jpg"), join(dir, "03.jpg"), join(dir, "04.jpg")]),
    git: { commitAndPush: vi.fn(() => "abc123"), rawUrl: (r: string, s: string, p: string) => `https://raw/${r}/${s}/${p}`, waitForUrl: vi.fn(async () => {}) },
    repo: "mcozcn/finducosmos",
    now: NOW,
    root,
    dryRun: false,
    ...over,
  } as any;
}

describe("runDailyPipeline", () => {
  it("publishes and records history", async () => {
    const d = await deps();
    const r = await runDailyPipeline(d);
    expect(r.status).toBe("published");
    expect(d.instagram!.publishCarousel).toHaveBeenCalledWith(
      ["https://raw/mcozcn/finducosmos/abc123/posts/2026-11-21/01.jpg", "https://raw/mcozcn/finducosmos/abc123/posts/2026-11-21/02.jpg",
       "https://raw/mcozcn/finducosmos/abc123/posts/2026-11-21/03.jpg", "https://raw/mcozcn/finducosmos/abc123/posts/2026-11-21/04.jpg"],
      expect.stringContaining("#uzay"),
    );
    const history = JSON.parse(await readFile(join(d.root, "history.json"), "utf8"));
    expect(history).toEqual([{ date: "2026-11-21", category: "solar_system", title: "Satürn 1", status: "published", mediaId: "M1", permalink: "https://ig/p" }]);
    expect(d.git.commitAndPush).toHaveBeenCalledTimes(2); // images, then history
    const contentJson = JSON.parse(await readFile(join(d.root, "posts/2026-11-21/content.json"), "utf8"));
    expect(contentJson.source.sourceUrl).toBe("https://images.nasa.gov/details/N1");
    expect(contentJson.verification).toEqual({ supported: true, unsupported: [], attempts: 1 });
    const wait = (d.git.waitForUrl as any).mock;
    expect(wait.calls).toHaveLength(4);
    const publishOrder = (d.instagram!.publishCarousel as any).mock.invocationCallOrder[0];
    for (const o of wait.invocationCallOrder) expect(o).toBeLessThan(publishOrder);
  });

  it("logs a ::error:: annotation and rethrows when the history push fails after publishing", async () => {
    const d = await deps();
    (d.git.commitAndPush as any).mockReturnValueOnce("abc123").mockImplementationOnce(() => { throw new Error("push rejected"); });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runDailyPipeline(d)).rejects.toThrow("push rejected");
    expect(d.instagram!.publishCarousel).toHaveBeenCalledTimes(1);
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("::error::");
    expect(logged).toContain("M1");
    errSpy.mockRestore();
  });

  it("logs 'Publish outcome unknown' and rethrows when publishCarousel fails at the publish stage", async () => {
    const d = await deps();
    (d.instagram!.publishCarousel as any).mockRejectedValueOnce(Object.assign(new Error("Instagram publish: HTTP 502 (creation car)"), { stage: "publish" }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runDailyPipeline(d)).rejects.toThrow("HTTP 502");
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("::error::Publish outcome unknown for 2026-11-21");
    errSpy.mockRestore();
  });

  it("does not log publish-unknown for earlier-stage failures", async () => {
    const d = await deps();
    (d.instagram!.publishCarousel as any).mockRejectedValueOnce(new Error("create item failed"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runDailyPipeline(d)).rejects.toThrow("create item");
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("does not offer an APOD that carries a copyright", async () => {
    const d = await deps();
    (d.nasa.apod as any).mockResolvedValue({ date: "2026-11-21", title: "Owned", explanation: "", url: "u", media_type: "image", copyright: "Some Photographer" });
    await runDailyPipeline(d);
    const prompt = (d.askJson as any).mock.calls.map((c: any) => c[0]).find((a: any) => Object.keys(a.schema.shape).includes("searchQueryEn")).user;
    expect(prompt).not.toContain("Owned");
  });

  it("skips when today is already published", async () => {
    const d = await deps();
    await writeFile(join(d.root, "history.json"), JSON.stringify([{ date: "2026-11-21", category: "apod", title: "x", status: "published", mediaId: "M0" }]));
    const r = await runDailyPipeline(d);
    expect(r.status).toBe("skipped");
    expect(d.git.commitAndPush).not.toHaveBeenCalled();
    expect(d.instagram!.publishCarousel).not.toHaveBeenCalled();
  });

  it("dry run renders but never pushes or publishes", async () => {
    const d = await deps({ dryRun: true });
    const r = await runDailyPipeline(d);
    expect(r.status).toBe("dry_run");
    expect(r.files).toHaveLength(4);
    expect(d.git.commitAndPush).not.toHaveBeenCalled();
    expect(d.instagram!.publishCarousel).not.toHaveBeenCalled();
    expect(await readFile(join(d.root, "history.json"), "utf8")).toBe("[]");
  });

  it("uses the Gemini fallback when NASA has text but no big image", async () => {
    const d = await deps({ sizeOf: () => ({ width: 500, height: 500 }) } as any);
    await runDailyPipeline(d);
    expect(d.imageModel.generate).toHaveBeenCalledTimes(1);
    expect((d.render as any).mock.calls[0][0].aiImage).toBe(true);
  });

  it("tries a new topic when NASA has no source text, up to 3 times", async () => {
    const d = await deps();
    (d.nasa.search as any).mockResolvedValue([]);
    await expect(runDailyPipeline(d)).rejects.toThrow("No NASA source found after 3 topics");
    expect(d.nasa.search).toHaveBeenCalledTimes(3);
    const topicPrompts = (d.askJson as any).mock.calls.map((c: any) => c[0]).filter((a: any) => Object.keys(a.schema.shape).includes("searchQueryEn")).map((a: any) => a.user);
    expect(topicPrompts[1]).toContain("Satürn 1");
  });
});
