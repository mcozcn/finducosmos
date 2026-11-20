import { appendFileSync } from "node:fs";
import { requireEnv } from "./config.js";
import { createInstagramClient } from "./instagram.js";

const ig = createInstagramClient({ userId: "me", token: requireEnv("IG_ACCESS_TOKEN") });
const { token, expiresIn } = await ig.refreshToken();
// Mask before anything else can print it, then hand it to the next step via GITHUB_OUTPUT.
console.log(`::add-mask::${token}`);
appendFileSync(requireEnv("GITHUB_OUTPUT"), `token=${token}\n`);
console.log(`Token refreshed; expires in ${Math.round(expiresIn / 86400)} days.`);
