import type { AskJson } from "./claude.js";
import { VerifySchema } from "./schemas.js";
import type { CarouselContent } from "./types.js";

const SYSTEM = `You are a strict fact checker. You compare Turkish Instagram slide text against an English NASA source text.
A sentence is supported only if every fact in it (numbers, names, dates, causes, comparisons) is stated in or directly implied by the source.
Rhetorical hooks, questions and calls to action without factual claims count as supported.`;

export async function verifyCarousel(args: {
  askJson: AskJson;
  content: CarouselContent;
  sourceText: string;
}): Promise<{ supported: boolean; unsupported: string[] }> {
  const sentences = [args.content.title, ...args.content.slides.map((s) => [s.heading, s.body].filter(Boolean).join(" — ")), args.content.caption];
  const user = `SOURCE TEXT:\n${args.sourceText}\n\nSLIDE TEXTS TO CHECK (one per line):\n${sentences.map((s) => `- ${s}`).join("\n")}\n\nList every unsupported sentence verbatim.`;
  const r = await args.askJson({ schema: VerifySchema, system: SYSTEM, user });
  return { supported: r.supported && r.unsupported.length === 0, unsupported: r.unsupported };
}
