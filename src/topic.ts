import type { AskJson } from "./claude.js";
import { TopicSchema } from "./schemas.js";
import { CATEGORIES, type Category, type TopicChoice } from "./types.js";

const SYSTEM = `You choose one topic per day for a Turkish-language Instagram page about space and astronomy.
Audience: curious general public in Turkey. Topics must be things NASA has published images and descriptions about.
Prefer surprising, concrete, visual topics. Write titleTr in natural Turkish.`;

export async function pickTopic(args: {
  askJson: AskJson;
  recent: string[];
  last: Category | null;
  apodTitle: string | null;
  exclude?: string[];
}): Promise<TopicChoice> {
  const banned = [...args.recent, ...(args.exclude ?? [])];
  const allowed = CATEGORIES.filter((c) => c !== args.last && (c !== "apod" || args.apodTitle !== null));
  const user = [
    `Allowed categories: ${allowed.join(", ")}`,
    `Yesterday's category (do not use): ${args.last ?? "none"}`,
    args.apodTitle
      ? `Today's NASA APOD image is "${args.apodTitle}". You may pick it (category "apod", useApod true) if it is interesting.`
      : `There is no usable APOD image today; useApod must be false.`,
    `Do NOT repeat or closely paraphrase any of these recent topics:\n${banned.map((t) => `- ${t}`).join("\n") || "- (none)"}`,
  ].join("\n\n");

  const t = await args.askJson({ schema: TopicSchema, system: SYSTEM, user });

  if (t.category === args.last) throw new Error(`Topic uses the same category as yesterday: ${t.category}`);
  if (t.useApod && !args.apodTitle) throw new Error("Topic wants APOD but there is no image APOD today");
  const norm = (s: string) => s.trim().toLocaleLowerCase("tr");
  if (banned.some((b) => norm(b) === norm(t.titleTr))) throw new Error(`Topic repeats a recent title: ${t.titleTr}`);
  return t;
}
