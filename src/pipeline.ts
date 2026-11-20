import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCaption } from "./caption.js";
import type { AskJson } from "./claude.js";
import { todayIstanbul } from "./config.js";
import { isPublished, lastCategory, loadHistory, recentTitles, saveHistory } from "./history.js";
import { generateFallbackImage, type ImageModel } from "./imagegen.js";
import type { InstagramClient } from "./instagram.js";
import type { NasaClient } from "./nasa.js";
import type { renderCarousel } from "./render/render.js";
import { findSource } from "./sources.js";
import { pickTopic } from "./topic.js";
import type { SourceMaterial, TopicChoice } from "./types.js";
import { writeVerifiedCarousel } from "./write.js";

export interface PipelineDeps {
  askJson: AskJson;
  nasa: NasaClient;
  sizeOf?: (b: Buffer) => { width?: number; height?: number };
  imageModel: ImageModel;
  instagram: InstagramClient | null; // null allowed in dry run
  render: typeof renderCarousel;
  git: {
    commitAndPush(paths: string[], message: string): string;
    rawUrl(repo: string, sha: string, path: string): string;
    waitForUrl(url: string): Promise<void>;
  };
  repo: string; // "owner/name"
  now: Date;
  root: string; // repo root on disk
  dryRun: boolean;
}

const MAX_TOPIC_TRIES = 3;

export async function runDailyPipeline(d: PipelineDeps): Promise<{ status: "skipped" | "dry_run" | "published"; date: string; files: string[] }> {
  const date = todayIstanbul(d.now);
  const historyPath = join(d.root, "history.json");
  const history = await loadHistory(historyPath);
  if (isPublished(history, date)) return { status: "skipped", date, files: [] };

  const apod = await d.nasa.apod().catch(() => null);
  const imageApod = apod && apod.media_type === "image" ? apod : null;

  let topic: TopicChoice | null = null;
  let source: SourceMaterial | null = null;
  const tried: string[] = [];
  for (let i = 0; i < MAX_TOPIC_TRIES && !source; i++) {
    topic = await pickTopic({
      askJson: d.askJson, recent: recentTitles(history), last: lastCategory(history),
      apodTitle: imageApod?.title ?? null, exclude: tried,
    });
    tried.push(topic.titleTr);
    source = await findSource(topic, { nasa: d.nasa, apod: imageApod, sizeOf: d.sizeOf });
  }
  if (!topic || !source) throw new Error(`No NASA source found after ${MAX_TOPIC_TRIES} topics: ${tried.join(", ")}`);

  const aiImage = source.image === null;
  const image = source.image ?? (await generateFallbackImage(topic, source.text, d.imageModel));
  const content = await writeVerifiedCarousel({ askJson: d.askJson, topic, source });
  const caption = buildCaption(content, { credit: source.credit, sourceUrl: source.sourceUrl, aiImage });

  const relDir = `posts/${date}`;
  const outDir = join(d.root, relDir);
  await mkdir(outDir, { recursive: true });
  const files = await d.render({ content, category: topic.category, credit: source.credit, image, aiImage }, outDir);
  await writeFile(
    join(outDir, "content.json"),
    JSON.stringify({ date, topic, source: { text: source.text, sourceUrl: source.sourceUrl, credit: source.credit }, aiImage, content, caption }, null, 2) + "\n",
  );

  if (d.dryRun) return { status: "dry_run", date, files };
  if (!d.instagram) throw new Error("Instagram client missing for a live run");

  const relFiles = files.map((f) => `${relDir}/${f.split("/").pop()}`);
  const sha = d.git.commitAndPush([...relFiles, `${relDir}/content.json`], `post: ${date} ${topic.titleTr}`);
  const urls = relFiles.map((p) => d.git.rawUrl(d.repo, sha, p));
  for (const u of urls) await d.git.waitForUrl(u);

  const { mediaId, permalink } = await d.instagram.publishCarousel(urls, caption);
  history.push({ date, category: topic.category, title: topic.titleTr, status: "published", mediaId, ...(permalink ? { permalink } : {}) });
  await saveHistory(historyPath, history);
  d.git.commitAndPush(["history.json"], `history: ${date} published`);
  return { status: "published", date, files };
}
