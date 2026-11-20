import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { CLAUDE_MODEL } from "./config.js";

export type AskJson = <S extends z.ZodType>(args: { schema: S; system: string; user: string }) => Promise<z.infer<S>>;

export function createAskJson(client: Anthropic = new Anthropic()): AskJson {
  return async ({ schema, system, user }) => {
    const res = await client.beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: user }],
    });
    if (res.stop_reason === "refusal") {
      throw new Error(`Claude refused (${res.stop_details?.category ?? "unknown"})`);
    }
    if (res.stop_reason === "max_tokens") throw new Error("Claude hit max_tokens");
    if (res.parsed_output == null) throw new Error("Claude returned no parseable output");
    return res.parsed_output as z.infer<typeof schema>;
  };
}
