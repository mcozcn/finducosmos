import { createAskJson } from "./claude.js";
import { isDryRun, requireEnv } from "./config.js";
import { commitAndPush, rawUrl, waitForUrl } from "./git.js";
import { createGeminiImageModel } from "./imagegen.js";
import { createInstagramClient } from "./instagram.js";
import { createNasaClient } from "./nasa.js";
import { runDailyPipeline } from "./pipeline.js";
import { renderCarousel } from "./render/render.js";

const dryRun = isDryRun();
const result = await runDailyPipeline({
  askJson: createAskJson(),
  nasa: createNasaClient(requireEnv("NASA_API_KEY")),
  imageModel: createGeminiImageModel(requireEnv("GEMINI_API_KEY")),
  instagram: dryRun ? null : createInstagramClient({ userId: requireEnv("IG_USER_ID"), token: requireEnv("IG_ACCESS_TOKEN") }),
  render: renderCarousel,
  git: { commitAndPush, rawUrl, waitForUrl: (u) => waitForUrl(u) },
  repo: requireEnv("GITHUB_REPOSITORY"),
  now: new Date(),
  root: process.cwd(),
  dryRun,
});
console.log(JSON.stringify(result, null, 2));
