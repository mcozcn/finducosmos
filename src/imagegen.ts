import { GoogleGenAI } from "@google/genai";
import { GEMINI_IMAGE_MODEL } from "./config.js";
import { withRetry } from "./retry.js";
import type { TopicChoice } from "./types.js";

export interface ImageModel { generate(prompt: string): Promise<Buffer> }

export function createGeminiImageModel(apiKey: string): ImageModel {
  const ai = new GoogleGenAI({ apiKey });
  return {
    generate: (prompt) =>
      withRetry(async () => {
        const res = await ai.models.generateContent({
          model: GEMINI_IMAGE_MODEL,
          contents: prompt,
          config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4" } },
        });
        const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (!part?.inlineData?.data) throw new Error("Gemini returned no image");
        return Buffer.from(part.inlineData.data, "base64");
      }, { label: "Gemini image" }),
  };
}

export async function generateFallbackImage(topic: TopicChoice, sourceText: string, model: ImageModel): Promise<Buffer> {
  const prompt = [
    `Photorealistic astronomy image of: ${topic.searchQueryEn}.`,
    `Scientific context: ${sourceText.slice(0, 600)}`,
    "Style: deep space, realistic lighting like a NASA telescope image, dark background, rich detail.",
    "Composition: vertical 3:4, main subject in the upper-middle, darker lower third for overlaid text.",
    "Absolutely no text, letters, logos, watermarks or borders.",
  ].join("\n");
  return model.generate(prompt);
}
