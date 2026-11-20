import type { AskJson } from "./claude.js";
import { CarouselSchema } from "./schemas.js";
import type { CarouselContent, SourceMaterial, TopicChoice } from "./types.js";
import { verifyCarousel } from "./verify.js";

const SYSTEM = `You write Turkish Instagram carousel posts for a space and astronomy page.
Use ONLY facts stated in the provided NASA source text. Do not add any number, date, name or claim that is not in the source.
If the source does not support a detail, leave it out rather than guessing.
Tone: curious, clear, friendly; natural Turkish; at most one emoji per slide; no clickbait lies.
Structure: a hook headline for the cover, then 2-3 short info slides that each teach one idea, building on each other.`;

export async function writeCarousel(args: {
  askJson: AskJson;
  topic: TopicChoice;
  source: SourceMaterial;
  feedback?: string[];
}): Promise<CarouselContent> {
  const parts = [
    `TOPIC: ${args.topic.titleTr}`,
    `NASA SOURCE TEXT:\n${args.source.text}`,
  ];
  if (args.feedback?.length) {
    parts.push(`A fact checker rejected these sentences as unsupported by the source. Remove or rewrite them using only the source:\n${args.feedback.map((f) => `- ${f}`).join("\n")}`);
  }
  const c = await args.askJson({ schema: CarouselSchema, system: SYSTEM, user: parts.join("\n\n") });

  if (c.slides.length < 2 || c.slides.length > 3) throw new Error(`Carousel must have 2-3 slides, got ${c.slides.length}`);
  const tooLong = c.slides.find((s) => s.body.length > 180);
  if (tooLong) throw new Error(`Slide body exceeds 180 characters: ${tooLong.body.slice(0, 40)}…`);
  return c;
}

export interface Verification {
  supported: boolean;
  unsupported: string[];
  attempts: number;
}

export async function writeVerifiedCarousel(args: {
  askJson: AskJson;
  topic: TopicChoice;
  source: SourceMaterial;
}): Promise<{ content: CarouselContent; verification: Verification }> {
  let feedback: string[] | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const content = await writeCarousel({ ...args, feedback });
    const v = await verifyCarousel({ askJson: args.askJson, content, sourceText: args.source.text });
    if (v.supported) return { content, verification: { supported: true, unsupported: v.unsupported, attempts: attempt } };
    feedback = v.unsupported;
  }
  throw new Error(`Carousel failed fact verification twice: ${feedback?.join(" | ")}`);
}
