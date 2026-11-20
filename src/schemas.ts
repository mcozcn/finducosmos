import { z } from "zod";
import { CATEGORIES } from "./types.js";

export const TopicSchema = z.object({
  category: z.enum(CATEGORIES),
  titleTr: z.string().describe("Short Turkish topic title, max 80 characters"),
  searchQueryEn: z.string().describe("2-5 word English search query for the NASA Image Library"),
  useApod: z.boolean().describe("true only if the topic is today's APOD"),
});

export const CarouselSchema = z.object({
  title: z.string().describe("Turkish cover headline, max 70 chars; wrap exactly one word in *asterisks* for emphasis"),
  slides: z
    .array(z.object({ heading: z.string().optional(), body: z.string() }))
    .describe("2 or 3 Turkish info slides; each body max 180 characters"),
  caption: z.string().describe("Turkish Instagram caption body, 300-900 characters, no hashtags"),
  hashtags: z.array(z.string()).describe("8-12 hashtags without '#', mixed Turkish and English"),
});

export const VerifySchema = z.object({
  supported: z.boolean(),
  unsupported: z.array(z.string()).describe("Exact sentences not supported by the source text"),
});
