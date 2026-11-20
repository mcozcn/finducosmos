# finducosmos Daily Space Carousel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GitHub Actions pipeline that every day picks a space topic, grounds it in NASA source text, writes a Turkish 4–5 slide carousel with Claude, renders it in the "Editorial" style, and publishes it to Instagram.

**Architecture:** Node.js + TypeScript run with `tsx`. Small single-purpose modules (`topic`, `sources`, `imagegen`, `write`, `verify`, `caption`, `render`, `instagram`, `history`, `git`) wired by `src/main.ts`. Every module that talks to the outside world receives its client as an argument, so tests pass fakes and never touch the network. State lives in the repo (`history.json`, `posts/YYYY-MM-DD/`).

**Tech Stack:** Node 24, TypeScript, tsx, vitest, zod 4, `@anthropic-ai/sdk` (structured outputs via `client.beta.messages.parse` + `betaZodOutputFormat`), `@google/genai`, Playwright (Chromium), `@fontsource/instrument-serif`, `@fontsource/inter-tight`, `image-size`.

**Spec:** `docs/superpowers/specs/2026-11-20-daily-space-carousel-design.md`

## Global Constraints

- Working directory for every command: repo root (`~/Documents/finducosmos`), branch `feat/daily-carousel`.
- ESM project: `"type": "module"` in package.json; import local files with the `.js` extension (`import { x } from "./history.js"`).
- Claude model: `claude-opus-5-5` (constant `CLAUDE_MODEL` in `src/config.ts`), `output_config.effort: "medium"`, server-side refusal fallback on (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`). No `thinking`, `temperature`, or prefill parameters.
- Gemini image model: env `GEMINI_IMAGE_MODEL`, default `gemini-2.5-flash-image`.
- Card size 1080×1350, JPEG quality 90, each file < 8 MB.
- Instagram limits: caption ≤ 2200 chars, ≤ 30 hashtags, 2–10 carousel items.
- Content language Turkish; time zone `Europe/Istanbul` for "today".
- Same topic must not repeat within the last 60 history entries; same category never two days in a row.
- Every claim on a card must come from the NASA source text; failed verification twice ⇒ no post.
- Never commit secrets. Secrets come only from environment variables.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, .nvmrc
src/
  types.ts          shared types + CATEGORIES
  schemas.ts        zod schemas for Claude structured outputs
  config.ts         env reading, constants, todayIstanbul()
  retry.ts          withRetry()
  history.ts        load/save/query history.json
  claude.ts         createAskJson() — the only Anthropic SDK touchpoint
  topic.ts          pickTopic()
  nasa.ts           NASA HTTP client (APOD + Image Library)
  sources.ts        findSource()
  imagegen.ts       generateFallbackImage() — the only Gemini touchpoint
  write.ts          writeCarousel()
  verify.ts         verifyCarousel()
  caption.ts        buildCaption()
  render/editorial.ts  HTML builders for cover / info / closing slides
  render/render.ts     renderCarousel() with Playwright
  instagram.ts      Instagram Graph API client (publish + refresh)
  git.ts            commitAndPush()
  main.ts           daily pipeline entry point
  refresh-token.ts  token refresh entry point
tests/              one *.test.ts per module + fixtures/
.github/workflows/daily.yml, refresh-token.yml, ci.yml
SETUP.md, README.md
```

---

### Task 1: Project scaffold, shared types, config, retry

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.nvmrc`, `src/types.ts`, `src/config.ts`, `src/retry.ts`
- Test: `tests/config.test.ts`, `tests/retry.test.ts`

**Interfaces:**
- Produces:
  - `CATEGORIES`, `type Category`, `interface HistoryEntry`, `interface TopicChoice`, `interface SourceMaterial`, `interface Slide`, `interface CarouselContent` (src/types.ts)
  - `CLAUDE_MODEL`, `IG_API_VERSION`, `ACCOUNT_HANDLE`, `todayIstanbul(now?: Date): string`, `requireEnv(name: string): string`, `isDryRun(): boolean` (src/config.ts)
  - `withRetry<T>(fn: () => Promise<T>, opts?: { attempts?: number; baseMs?: number; label?: string }): Promise<T>` (src/retry.ts)

- [ ] **Step 1: Create package.json and install dependencies**

```json
{
  "name": "finducosmos",
  "private": true,
  "type": "module",
  "scripts": {
    "post": "tsx src/main.ts",
    "refresh-token": "tsx src/refresh-token.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Run:
```bash
npm i @anthropic-ai/sdk @google/genai zod playwright @fontsource/instrument-serif @fontsource/inter-tight image-size
npm i -D typescript tsx vitest @types/node
npx playwright install chromium
echo 24 > .nvmrc
```

- [ ] **Step 2: Create tsconfig.json and vitest.config.ts**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], testTimeout: 60_000 } });
```

- [ ] **Step 3: Create src/types.ts**

```ts
export const CATEGORIES = [
  "solar_system",
  "stars_galaxies",
  "black_holes",
  "missions_history",
  "scale",
  "apod",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL_TR: Record<Category, string> = {
  solar_system: "Güneş Sistemi",
  stars_galaxies: "Yıldızlar & Galaksiler",
  black_holes: "Kara Delikler",
  missions_history: "Görevler & Tarih",
  scale: "Ölçek",
  apod: "Günün Görüntüsü",
};

export interface HistoryEntry {
  date: string; // YYYY-MM-DD, Europe/Istanbul
  category: Category;
  title: string;
  status: "published";
  mediaId: string;
  permalink?: string;
}

export interface TopicChoice {
  category: Category;
  titleTr: string;
  searchQueryEn: string;
  useApod: boolean;
}

export interface SourceMaterial {
  text: string; // NASA's own description, plain text
  sourceUrl: string;
  credit: string; // e.g. "NASA/JPL-Caltech"
  image: Buffer | null; // null => needs AI fallback image
}

export interface Slide {
  heading?: string;
  body: string;
}

export interface CarouselContent {
  title: string; // cover headline; one word may be wrapped in *asterisks* for italic accent
  slides: Slide[]; // 2–3 info slides (cover and closing are added by the renderer)
  caption: string; // body text only; credits and hashtags are appended by buildCaption
  hashtags: string[]; // without '#'
}
```

- [ ] **Step 4: Write failing tests for config and retry**

```ts
// tests/config.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { todayIstanbul, requireEnv, isDryRun } from "../src/config.js";

describe("todayIstanbul", () => {
  it("uses Istanbul date, not UTC", () => {
    // 2026-11-20 22:30 UTC is 2026-11-21 01:30 in Istanbul (UTC+3)
    expect(todayIstanbul(new Date("2026-11-20T22:30:00Z"))).toBe("2026-11-21");
  });
});

describe("requireEnv", () => {
  afterEach(() => { delete process.env.FC_TEST_VAR; });
  it("returns the value when set", () => {
    process.env.FC_TEST_VAR = "x";
    expect(requireEnv("FC_TEST_VAR")).toBe("x");
  });
  it("throws a clear error when missing", () => {
    expect(() => requireEnv("FC_TEST_VAR")).toThrow("Missing required environment variable FC_TEST_VAR");
  });
});

describe("isDryRun", () => {
  afterEach(() => { delete process.env.DRY_RUN; });
  it("is true unless DRY_RUN is exactly 'false'", () => {
    expect(isDryRun()).toBe(true);
    process.env.DRY_RUN = "true";
    expect(isDryRun()).toBe(true);
    process.env.DRY_RUN = "false";
    expect(isDryRun()).toBe(false);
  });
});
```

```ts
// tests/retry.test.ts
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/retry.js";

describe("withRetry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    await expect(withRetry(fn, { baseMs: 1 })).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("retries then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue("ok");
    await expect(withRetry(fn, { baseMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("throws the last error after all attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("down"));
    await expect(withRetry(fn, { attempts: 3, baseMs: 1, label: "nasa" })).rejects.toThrow("nasa failed after 3 attempts: down");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run tests/config.test.ts tests/retry.test.ts`
Expected: FAIL — cannot resolve `../src/config.js` / `../src/retry.js`.

- [ ] **Step 6: Implement src/config.ts and src/retry.ts**

```ts
// src/config.ts
export const CLAUDE_MODEL = "claude-opus-5-5";
export const IG_API_VERSION = process.env.IG_API_VERSION ?? "v23.0";
export const ACCOUNT_HANDLE = "@finducosmos";
export const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
export const HISTORY_WINDOW = 60;

export function todayIstanbul(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(now);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/** Safe default: anything other than the literal "false" is a dry run. */
export function isDryRun(): boolean {
  return process.env.DRY_RUN !== "false";
}
```

```ts
// src/retry.ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 1000;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${opts.label ?? "operation"} failed after ${attempts} attempts: ${msg}`, { cause: lastError });
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run tests/config.test.ts tests/retry.test.ts && npm run typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .nvmrc src tests
git commit -m "feat: scaffold project with shared types, config and retry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: History store

**Files:**
- Create: `src/history.ts`, `history.json` (content: `[]`)
- Test: `tests/history.test.ts`

**Interfaces:**
- Consumes: `HistoryEntry`, `Category` (Task 1), `HISTORY_WINDOW` (Task 1)
- Produces:
  - `loadHistory(path: string): Promise<HistoryEntry[]>`
  - `saveHistory(path: string, entries: HistoryEntry[]): Promise<void>`
  - `recentTitles(entries: HistoryEntry[], n?: number): string[]`
  - `lastCategory(entries: HistoryEntry[]): Category | null`
  - `isPublished(entries: HistoryEntry[], date: string): boolean`

- [ ] **Step 1: Write failing tests**

```ts
// tests/history.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHistory, saveHistory, recentTitles, lastCategory, isPublished } from "../src/history.js";
import type { HistoryEntry } from "../src/types.js";

const entry = (date: string, title: string, category: HistoryEntry["category"] = "solar_system"): HistoryEntry =>
  ({ date, title, category, status: "published", mediaId: `m-${date}` });

describe("history", () => {
  it("returns [] when the file does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fc-"));
    expect(await loadHistory(join(dir, "nope.json"))).toEqual([]);
  });

  it("round-trips entries as pretty JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fc-"));
    const p = join(dir, "history.json");
    await saveHistory(p, [entry("2026-11-20", "Satürn")]);
    expect(await loadHistory(p)).toEqual([entry("2026-11-20", "Satürn")]);
    expect(await readFile(p, "utf8")).toContain('\n  {');
  });

  it("recentTitles returns the newest n titles", () => {
    const list = Array.from({ length: 70 }, (_, i) => entry(`2026-01-${String(i).padStart(2, "0")}`, `t${i}`));
    const titles = recentTitles(list, 60);
    expect(titles).toHaveLength(60);
    expect(titles[0]).toBe("t69");
    expect(titles).not.toContain("t9");
  });

  it("lastCategory is the category of the newest entry or null", () => {
    expect(lastCategory([])).toBeNull();
    expect(lastCategory([entry("2026-11-19", "a", "scale"), entry("2026-11-20", "b", "apod")])).toBe("apod");
  });

  it("isPublished matches the date", () => {
    const list = [entry("2026-11-20", "a")];
    expect(isPublished(list, "2026-11-20")).toBe(true);
    expect(isPublished(list, "2026-11-21")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/history.test.ts`
Expected: FAIL — cannot resolve `../src/history.js`.

- [ ] **Step 3: Implement src/history.ts and create history.json**

```ts
// src/history.ts
import { readFile, writeFile } from "node:fs/promises";
import { HISTORY_WINDOW } from "./config.js";
import type { Category, HistoryEntry } from "./types.js";

export async function loadHistory(path: string): Promise<HistoryEntry[]> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as HistoryEntry[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function saveHistory(path: string, entries: HistoryEntry[]): Promise<void> {
  await writeFile(path, JSON.stringify(entries, null, 2) + "\n", "utf8");
}

/** Entries are appended chronologically; newest is last. */
export function recentTitles(entries: HistoryEntry[], n = HISTORY_WINDOW): string[] {
  return entries.slice(-n).reverse().map((e) => e.title);
}

export function lastCategory(entries: HistoryEntry[]): Category | null {
  return entries.at(-1)?.category ?? null;
}

export function isPublished(entries: HistoryEntry[], date: string): boolean {
  return entries.some((e) => e.date === date && e.status === "published");
}
```

```bash
echo "[]" > history.json
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/history.ts history.json tests/history.test.ts
git commit -m "feat: add history store with dedupe and double-post queries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Claude structured-output helper and topic picker

**Files:**
- Create: `src/schemas.ts`, `src/claude.ts`, `src/topic.ts`
- Test: `tests/topic.test.ts`

**Interfaces:**
- Consumes: `CATEGORIES`, `Category`, `TopicChoice` (Task 1)
- Produces:
  - `TopicSchema`, `CarouselSchema`, `VerifySchema` (zod, src/schemas.ts)
  - `type AskJson = <S extends z.ZodType>(args: { schema: S; system: string; user: string }) => Promise<z.infer<S>>` (src/claude.ts)
  - `createAskJson(client?: Anthropic): AskJson` (src/claude.ts)
  - `pickTopic(args: { askJson: AskJson; recent: string[]; last: Category | null; apodTitle: string | null; exclude?: string[] }): Promise<TopicChoice>` (src/topic.ts)

- [ ] **Step 1: Create src/schemas.ts**

```ts
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
```

- [ ] **Step 2: Create src/claude.ts (thin SDK wrapper; exercised by the live dry run, not unit tests)**

```ts
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
```

Note: if `tsc` reports a property name mismatch on `stop_details` or the `fallbacks` field, fix it from the compiler message against `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts` — do not remove the refusal check.

- [ ] **Step 3: Write failing tests for pickTopic**

```ts
// tests/topic.test.ts
import { describe, it, expect, vi } from "vitest";
import { pickTopic } from "../src/topic.js";
import type { AskJson } from "../src/claude.js";

const fakeAsk = (result: unknown) => vi.fn(async () => result) as unknown as AskJson & ReturnType<typeof vi.fn>;

describe("pickTopic", () => {
  it("returns the model's choice when it respects the rules", async () => {
    const ask = fakeAsk({ category: "black_holes", titleTr: "Olay ufku", searchQueryEn: "black hole event horizon", useApod: false });
    const t = await pickTopic({ askJson: ask, recent: ["Satürn"], last: "solar_system", apodTitle: null });
    expect(t.category).toBe("black_holes");
  });

  it("puts recent titles, last category and APOD title into the prompt", async () => {
    const ask = fakeAsk({ category: "apod", titleTr: "Orion", searchQueryEn: "orion nebula", useApod: true });
    await pickTopic({ askJson: ask, recent: ["Satürn", "Mars"], last: "scale", apodTitle: "The Orion Nebula" });
    const { user } = (ask as any).mock.calls[0][0];
    expect(user).toContain("Satürn");
    expect(user).toContain("Mars");
    expect(user).toContain("scale");
    expect(user).toContain("The Orion Nebula");
  });

  it("rejects a repeated category", async () => {
    const ask = fakeAsk({ category: "scale", titleTr: "x", searchQueryEn: "x", useApod: false });
    await expect(pickTopic({ askJson: ask, recent: [], last: "scale", apodTitle: null })).rejects.toThrow("same category");
  });

  it("rejects a repeated title (case-insensitive)", async () => {
    const ask = fakeAsk({ category: "scale", titleTr: "satürn", searchQueryEn: "x", useApod: false });
    await expect(pickTopic({ askJson: ask, recent: ["Satürn"], last: null, apodTitle: null })).rejects.toThrow("repeats");
  });

  it("rejects useApod when there is no image APOD today", async () => {
    const ask = fakeAsk({ category: "apod", titleTr: "x", searchQueryEn: "x", useApod: true });
    await expect(pickTopic({ askJson: ask, recent: [], last: null, apodTitle: null })).rejects.toThrow("APOD");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/topic.test.ts`
Expected: FAIL — cannot resolve `../src/topic.js`.

- [ ] **Step 5: Implement src/topic.ts**

```ts
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
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/topic.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/schemas.ts src/claude.ts src/topic.ts tests/topic.test.ts
git commit -m "feat: add Claude structured-output helper and topic picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: NASA client and source finder

**Files:**
- Create: `src/nasa.ts`, `src/sources.ts`, `tests/fixtures/apod.json`, `tests/fixtures/search.json`
- Test: `tests/sources.test.ts`

**Interfaces:**
- Consumes: `withRetry` (Task 1), `TopicChoice`, `SourceMaterial` (Task 1)
- Produces:
  - `interface Apod { date: string; title: string; explanation: string; url: string; hdurl?: string; media_type: string; copyright?: string }`
  - `interface SearchItem { nasaId: string; title: string; description: string; center?: string; credit?: string; assetManifestUrl: string }`
  - `interface NasaClient { apod(): Promise<Apod>; search(q: string): Promise<SearchItem[]>; assetUrls(manifestUrl: string): Promise<string[]>; download(url: string): Promise<Buffer> }`
  - `createNasaClient(apiKey: string, fetchFn?: typeof fetch): NasaClient`
  - `findSource(topic: TopicChoice, deps: { nasa: NasaClient; apod: Apod | null; sizeOf?: (b: Buffer) => { width?: number; height?: number } }): Promise<SourceMaterial | null>`
  - `stripHtml(s: string): string`

- [ ] **Step 1: Create fixtures**

`tests/fixtures/apod.json`:

```json
{
  "date": "2026-11-20",
  "title": "The Orion Nebula",
  "explanation": "The Orion Nebula is a stellar nursery about 1,300 light-years away. It is one of the closest regions of massive star formation to Earth and is visible to the naked eye as a fuzzy patch in the sword of Orion. Young hot stars at its center light up the surrounding gas.",
  "url": "https://apod.nasa.gov/apod/image/2611/orion_1024.jpg",
  "hdurl": "https://apod.nasa.gov/apod/image/2611/orion_big.jpg",
  "media_type": "image",
  "copyright": "\nJane Astro\n"
}
```

`tests/fixtures/search.json`:

```json
{
  "collection": {
    "items": [
      {
        "href": "https://images-assets.nasa.gov/image/short/collection.json",
        "data": [{ "nasa_id": "short", "title": "Short", "description": "Too short.", "center": "JPL" }]
      },
      {
        "href": "https://images-assets.nasa.gov/image/PIA21046/collection.json",
        "data": [{
          "nasa_id": "PIA21046",
          "title": "Saturn's Rings",
          "description": "<p>Saturn's rings are made mostly of water ice particles ranging in size from tiny grains to chunks as big as mountains. Cassini observations show that material from the rings is falling into Saturn as a rain of ice, which suggests the rings are slowly disappearing over time.</p>",
          "center": "JPL",
          "secondary_creator": "NASA/JPL-Caltech/Space Science Institute"
        }]
      }
    ]
  }
}
```

- [ ] **Step 2: Write failing tests**

```ts
// tests/sources.test.ts
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { findSource, stripHtml } from "../src/sources.js";
import { createNasaClient, type Apod, type NasaClient } from "../src/nasa.js";
import type { TopicChoice } from "../src/types.js";

const apod = JSON.parse(readFileSync("tests/fixtures/apod.json", "utf8")) as Apod;
const searchJson = JSON.parse(readFileSync("tests/fixtures/search.json", "utf8"));

// Minimal valid JPEG headers of a given size are awkward to hand-build, so fake image bytes via imageSize injection:
const bigJpeg = Buffer.from("big");
const smallJpeg = Buffer.from("small");
const sizeOf = (b: Buffer) => (b === bigJpeg ? { width: 2000, height: 1500 } : { width: 800, height: 600 });

function fakeNasa(over: Partial<NasaClient> = {}): NasaClient {
  return {
    apod: vi.fn(async () => apod),
    search: vi.fn(async () => createNasaClient("k", async () => new Response(JSON.stringify(searchJson))).search("x")),
    assetUrls: vi.fn(async () => ["https://x/a~orig.jpg", "https://x/a~large.jpg", "https://x/a~thumb.jpg"]),
    download: vi.fn(async () => bigJpeg),
    ...over,
  } as NasaClient;
}

const topic = (o: Partial<TopicChoice> = {}): TopicChoice =>
  ({ category: "solar_system", titleTr: "Satürn", searchQueryEn: "saturn rings", useApod: false, ...o });

describe("stripHtml", () => {
  it("removes tags and collapses whitespace", () => {
    expect(stripHtml("<p>Hello <b>world</b></p>\n\n x")).toBe("Hello world x");
  });
});

describe("findSource", () => {
  it("uses APOD when the topic says so", async () => {
    const nasa = fakeNasa();
    const s = await findSource(topic({ useApod: true, category: "apod" }), { nasa, apod, sizeOf });
    expect(s?.text).toContain("stellar nursery");
    expect(s?.credit).toBe("© Jane Astro");
    expect(s?.sourceUrl).toBe("https://apod.nasa.gov/apod/ap261120.html");
    expect(nasa.download).toHaveBeenCalledWith(apod.hdurl);
  });

  it("skips results whose description is under 200 chars and prefers ~orig", async () => {
    const nasa = fakeNasa();
    const s = await findSource(topic(), { nasa, apod: null, sizeOf });
    expect(s?.text.startsWith("Saturn's rings are made")).toBe(true);
    expect(s?.credit).toBe("NASA/JPL-Caltech/Space Science Institute");
    expect(s?.sourceUrl).toBe("https://images.nasa.gov/details/PIA21046");
    expect(nasa.download).toHaveBeenCalledWith("https://x/a~orig.jpg");
    expect(s?.image).toBe(bigJpeg);
  });

  it("keeps the text but returns image null when every image is too small", async () => {
    const nasa = fakeNasa({ download: vi.fn(async () => smallJpeg) });
    const s = await findSource(topic(), { nasa, apod: null, sizeOf });
    expect(s?.text).toContain("Saturn's rings");
    expect(s?.image).toBeNull();
  });

  it("returns null when no result has enough text", async () => {
    const nasa = fakeNasa({ search: vi.fn(async () => []) });
    expect(await findSource(topic(), { nasa, apod: null, sizeOf })).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/sources.test.ts`
Expected: FAIL — cannot resolve `../src/sources.js`.

- [ ] **Step 4: Implement src/nasa.ts**

```ts
import { withRetry } from "./retry.js";

export interface Apod {
  date: string; title: string; explanation: string; url: string;
  hdurl?: string; media_type: string; copyright?: string;
}
export interface SearchItem {
  nasaId: string; title: string; description: string;
  center?: string; credit?: string; assetManifestUrl: string;
}
export interface NasaClient {
  apod(): Promise<Apod>;
  search(q: string): Promise<SearchItem[]>;
  assetUrls(manifestUrl: string): Promise<string[]>;
  download(url: string): Promise<Buffer>;
}

export function createNasaClient(apiKey: string, fetchFn: typeof fetch = fetch): NasaClient {
  const getJson = (url: string, label: string) =>
    withRetry(async () => {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).pathname}`);
      return res.json();
    }, { label });

  return {
    async apod() {
      return (await getJson(`https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(apiKey)}`, "NASA APOD")) as Apod;
    },
    async search(q) {
      const url = `https://images-api.nasa.gov/search?media_type=image&q=${encodeURIComponent(q)}`;
      const json = (await getJson(url, "NASA search")) as {
        collection: { items: { href: string; data: Record<string, string>[] }[] };
      };
      return json.collection.items.map((it) => {
        const d = it.data[0] ?? {};
        return {
          nasaId: d.nasa_id, title: d.title, description: d.description ?? "",
          center: d.center, credit: d.secondary_creator ?? d.photographer, assetManifestUrl: it.href,
        };
      });
    },
    async assetUrls(manifestUrl) {
      return (await getJson(manifestUrl, "NASA assets")) as string[];
    },
    async download(url) {
      return withRetry(async () => {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} downloading image`);
        return Buffer.from(await res.arrayBuffer());
      }, { label: "NASA image download" });
    },
  };
}
```

- [ ] **Step 5: Implement src/sources.ts**

```ts
import { imageSize } from "image-size";
import type { Apod, NasaClient } from "./nasa.js";
import type { SourceMaterial, TopicChoice } from "./types.js";

const MIN_TEXT = 200;
const MIN_SHORT_EDGE = 1080;
const MAX_CANDIDATES = 10;

type SizeOf = (b: Buffer) => { width?: number; height?: number };

export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function bigEnough(buf: Buffer, sizeOf: SizeOf): boolean {
  const { width = 0, height = 0 } = sizeOf(buf);
  return Math.min(width, height) >= MIN_SHORT_EDGE;
}

function apodPageUrl(date: string): string {
  const [y, m, d] = date.split("-");
  return `https://apod.nasa.gov/apod/ap${y.slice(2)}${m}${d}.html`;
}

export async function findSource(
  topic: TopicChoice,
  deps: { nasa: NasaClient; apod: Apod | null; sizeOf?: SizeOf },
): Promise<SourceMaterial | null> {
  const sizeOf = deps.sizeOf ?? ((b: Buffer) => imageSize(b));

  if (topic.useApod && deps.apod) {
    const a = deps.apod;
    const img = await deps.nasa.download(a.hdurl ?? a.url);
    return {
      text: stripHtml(a.explanation),
      sourceUrl: apodPageUrl(a.date),
      credit: a.copyright ? `© ${a.copyright.replace(/\s+/g, " ").trim()}` : "NASA APOD",
      image: bigEnough(img, sizeOf) ? img : null,
    };
  }

  const items = (await deps.nasa.search(topic.searchQueryEn))
    .filter((it) => stripHtml(it.description).length >= MIN_TEXT)
    .slice(0, MAX_CANDIDATES);
  if (items.length === 0) return null;

  const toSource = (it: (typeof items)[number], image: Buffer | null): SourceMaterial => ({
    text: stripHtml(it.description),
    sourceUrl: `https://images.nasa.gov/details/${it.nasaId}`,
    credit: it.credit ?? (it.center ? `NASA/${it.center}` : "NASA"),
    image,
  });

  for (const it of items) {
    const urls = await deps.nasa.assetUrls(it.assetManifestUrl);
    const best = urls.find((u) => u.includes("~orig.jpg")) ?? urls.find((u) => u.includes("~large.jpg"));
    if (!best) continue;
    const img = await deps.nasa.download(best);
    if (bigEnough(img, sizeOf)) return toSource(it, img);
  }
  return toSource(items[0], null);
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/sources.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/nasa.ts src/sources.ts tests/sources.test.ts tests/fixtures
git commit -m "feat: add NASA client and grounded source finder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Gemini fallback image

**Files:**
- Create: `src/imagegen.ts`
- Test: `tests/imagegen.test.ts`

**Interfaces:**
- Consumes: `withRetry`, `GEMINI_IMAGE_MODEL` (Task 1)
- Produces:
  - `interface ImageModel { generate(prompt: string): Promise<Buffer> }`
  - `createGeminiImageModel(apiKey: string): ImageModel`
  - `generateFallbackImage(topic: TopicChoice, sourceText: string, model: ImageModel): Promise<Buffer>`

- [ ] **Step 1: Write failing test**

```ts
// tests/imagegen.test.ts
import { describe, it, expect, vi } from "vitest";
import { generateFallbackImage } from "../src/imagegen.js";

describe("generateFallbackImage", () => {
  it("builds a no-text photoreal prompt from the topic and source", async () => {
    const generate = vi.fn(async () => Buffer.from("img"));
    const out = await generateFallbackImage(
      { category: "black_holes", titleTr: "Olay ufku", searchQueryEn: "black hole event horizon", useApod: false },
      "A black hole is a region of spacetime where gravity is so strong that nothing can escape.",
      { generate },
    );
    expect(out.toString()).toBe("img");
    const prompt = generate.mock.calls[0][0] as string;
    expect(prompt).toContain("black hole event horizon");
    expect(prompt).toContain("no text");
    expect(prompt).toContain("4:5");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/imagegen.test.ts`
Expected: FAIL — cannot resolve `../src/imagegen.js`.

- [ ] **Step 3: Implement src/imagegen.ts**

```ts
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
          config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:5" } },
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
    "Composition: vertical 4:5, main subject in the upper-middle, darker lower third for overlaid text.",
    "Absolutely no text, letters, logos, watermarks or borders.",
  ].join("\n");
  return model.generate(prompt);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/imagegen.test.ts && npm run typecheck`
Expected: PASS. If `tsc` rejects `imageConfig`/`aspectRatio`, check `node_modules/@google/genai/dist/genai.d.ts` (`interface ImageConfig`) and fix the field name.

- [ ] **Step 5: Commit**

```bash
git add src/imagegen.ts tests/imagegen.test.ts
git commit -m "feat: add Gemini fallback image generation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Carousel writing, fact verification, caption

**Files:**
- Create: `src/write.ts`, `src/verify.ts`, `src/caption.ts`
- Test: `tests/write.test.ts`, `tests/caption.test.ts`

**Interfaces:**
- Consumes: `AskJson` (Task 3), `CarouselSchema`, `VerifySchema` (Task 3), `TopicChoice`, `SourceMaterial`, `CarouselContent` (Task 1), `ACCOUNT_HANDLE` (Task 1)
- Produces:
  - `writeCarousel(args: { askJson: AskJson; topic: TopicChoice; source: SourceMaterial; feedback?: string[] }): Promise<CarouselContent>`
  - `verifyCarousel(args: { askJson: AskJson; content: CarouselContent; sourceText: string }): Promise<{ supported: boolean; unsupported: string[] }>`
  - `writeVerifiedCarousel(args: { askJson: AskJson; topic: TopicChoice; source: SourceMaterial }): Promise<CarouselContent>` — write → verify → rewrite once → throw
  - `buildCaption(content: CarouselContent, meta: { credit: string; sourceUrl: string; aiImage: boolean }): string`
  - `CORE_HASHTAGS: string[]`

- [ ] **Step 1: Write failing tests**

```ts
// tests/write.test.ts
import { describe, it, expect, vi } from "vitest";
import { writeCarousel, writeVerifiedCarousel } from "../src/write.js";
import type { CarouselContent, SourceMaterial, TopicChoice } from "../src/types.js";

const topic: TopicChoice = { category: "solar_system", titleTr: "Satürn'ün halkaları", searchQueryEn: "saturn rings", useApod: false };
const source: SourceMaterial = { text: "Saturn's rings are made of ice.", sourceUrl: "u", credit: "NASA", image: null };
const good: CarouselContent = {
  title: "Satürn'ün halkaları *yavaşça* yok oluyor",
  slides: [{ body: "Halkalar buzdan oluşur." }, { body: "Buz Satürn'e yağıyor." }],
  caption: "Satürn hakkında.", hashtags: ["uzay", "saturn"],
};

describe("writeCarousel", () => {
  it("sends source text and grounding rule; passes feedback on rewrite", async () => {
    const ask = vi.fn(async () => good);
    await writeCarousel({ askJson: ask as any, topic, source, feedback: ["Buz Satürn'e yağıyor."] });
    const { system, user } = ask.mock.calls[0][0] as any;
    expect(system).toContain("ONLY");
    expect(user).toContain("Saturn's rings are made of ice.");
    expect(user).toContain("Buz Satürn'e yağıyor.");
  });

  it("rejects slide counts outside 2-3 and bodies over 180 chars", async () => {
    const one = vi.fn(async () => ({ ...good, slides: [{ body: "a" }] }));
    await expect(writeCarousel({ askJson: one as any, topic, source })).rejects.toThrow("2-3 slides");
    const long = vi.fn(async () => ({ ...good, slides: [{ body: "a".repeat(181) }, { body: "b" }] }));
    await expect(writeCarousel({ askJson: long as any, topic, source })).rejects.toThrow("180");
  });
});

describe("writeVerifiedCarousel", () => {
  it("returns content when verification passes first time", async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce(good)
      .mockResolvedValueOnce({ supported: true, unsupported: [] });
    await expect(writeVerifiedCarousel({ askJson: ask as any, topic, source })).resolves.toEqual(good);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("rewrites once with feedback, then succeeds", async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce(good)
      .mockResolvedValueOnce({ supported: false, unsupported: ["Buz Satürn'e yağıyor."] })
      .mockResolvedValueOnce(good)
      .mockResolvedValueOnce({ supported: true, unsupported: [] });
    await writeVerifiedCarousel({ askJson: ask as any, topic, source });
    expect((ask.mock.calls[2][0] as any).user).toContain("Buz Satürn'e yağıyor.");
  });

  it("throws when verification fails twice", async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce(good)
      .mockResolvedValueOnce({ supported: false, unsupported: ["x"] })
      .mockResolvedValueOnce(good)
      .mockResolvedValueOnce({ supported: false, unsupported: ["y"] });
    await expect(writeVerifiedCarousel({ askJson: ask as any, topic, source })).rejects.toThrow("failed fact verification");
  });
});
```

```ts
// tests/caption.test.ts
import { describe, it, expect } from "vitest";
import { buildCaption, CORE_HASHTAGS } from "../src/caption.js";
import type { CarouselContent } from "../src/types.js";

const base: CarouselContent = { title: "t", slides: [], caption: "Gövde metni.", hashtags: ["#Satürn", "uzay", "space"] };

describe("buildCaption", () => {
  it("appends credit, source, follow line and normalized, deduped hashtags", () => {
    const c = buildCaption(base, { credit: "NASA/JPL-Caltech", sourceUrl: "https://images.nasa.gov/details/X", aiImage: false });
    expect(c.startsWith("Gövde metni.")).toBe(true);
    expect(c).toContain("📷 NASA/JPL-Caltech");
    expect(c).toContain("Kaynak: https://images.nasa.gov/details/X");
    expect(c).toContain("#satürn");
    expect(c.match(/#uzay\b/g)).toHaveLength(1);
    expect(c).not.toContain("AI");
  });

  it("notes AI images", () => {
    expect(buildCaption(base, { credit: "NASA", sourceUrl: "u", aiImage: true })).toContain("Görsel yapay zekâ ile üretilmiştir");
  });

  it("caps hashtags at 30 and total length at 2200", () => {
    const many = { ...base, caption: "x".repeat(3000), hashtags: Array.from({ length: 50 }, (_, i) => `tag${i}`) };
    const c = buildCaption(many, { credit: "NASA", sourceUrl: "u", aiImage: false });
    expect(c.length).toBeLessThanOrEqual(2200);
    expect((c.match(/#\S+/g) ?? []).length).toBeLessThanOrEqual(30);
    expect(c).toContain("📷 NASA"); // credit survives truncation
  });

  it("always includes the core hashtags", () => {
    const c = buildCaption({ ...base, hashtags: [] }, { credit: "NASA", sourceUrl: "u", aiImage: false });
    for (const h of CORE_HASHTAGS) expect(c).toContain(`#${h}`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/write.test.ts tests/caption.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement src/verify.ts**

```ts
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
```

- [ ] **Step 4: Implement src/write.ts**

```ts
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

export async function writeVerifiedCarousel(args: {
  askJson: AskJson;
  topic: TopicChoice;
  source: SourceMaterial;
}): Promise<CarouselContent> {
  let feedback: string[] | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const content = await writeCarousel({ ...args, feedback });
    const v = await verifyCarousel({ askJson: args.askJson, content, sourceText: args.source.text });
    if (v.supported) return content;
    feedback = v.unsupported;
  }
  throw new Error(`Carousel failed fact verification twice: ${feedback?.join(" | ")}`);
}
```

- [ ] **Step 5: Implement src/caption.ts**

```ts
import { ACCOUNT_HANDLE } from "./config.js";
import type { CarouselContent } from "./types.js";

export const CORE_HASHTAGS = ["uzay", "astronomi", "space", "nasa", "evren"];
const MAX_CAPTION = 2200;
const MAX_TAGS = 30;

const normTag = (t: string) => t.replace(/^#+/, "").replace(/\s+/g, "").toLocaleLowerCase("tr");

export function buildCaption(
  content: CarouselContent,
  meta: { credit: string; sourceUrl: string; aiImage: boolean },
): string {
  const tags = [...new Set([...CORE_HASHTAGS, ...content.hashtags].map(normTag).filter(Boolean))].slice(0, MAX_TAGS);
  const footer = [
    "",
    `📷 ${meta.credit}`,
    ...(meta.aiImage ? ["Görsel yapay zekâ ile üretilmiştir; bilgiler NASA kaynağındandır."] : []),
    `Kaynak: ${meta.sourceUrl}`,
    `Kaydet & takip et → ${ACCOUNT_HANDLE}`,
    "",
    tags.map((t) => `#${t}`).join(" "),
  ].join("\n");
  const room = MAX_CAPTION - footer.length;
  const body = content.caption.length > room ? content.caption.slice(0, room - 1).trimEnd() + "…" : content.caption;
  return body + footer;
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/write.test.ts tests/caption.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/write.ts src/verify.ts src/caption.ts tests/write.test.ts tests/caption.test.ts
git commit -m "feat: add grounded carousel writer, fact verifier and caption builder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Editorial card renderer

**Files:**
- Create: `src/render/editorial.ts`, `src/render/render.ts`
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: `CarouselContent`, `Category`, `CATEGORY_LABEL_TR` (Task 1), `ACCOUNT_HANDLE` (Task 1)
- Produces:
  - `interface RenderInput { content: CarouselContent; category: Category; credit: string; image: Buffer; aiImage: boolean }`
  - `slideHtml(kind: "cover" | "info" | "closing", input: RenderInput, index: number, total: number): string` (src/render/editorial.ts)
  - `escapeHtml(s: string): string`, `emphasize(s: string): string`
  - `renderCarousel(input: RenderInput, outDir: string): Promise<string[]>` — returns absolute paths `01.jpg…NN.jpg` in order (src/render/render.ts)

Design reference (approved mockup "A — Editoryal", scaled ×3.75 from the 288×360 mockup): Instrument Serif headlines with one italic word in `#f1d7a6`; Inter Tight small caps labels; background `#0b0c14`; body text ≥ 40 px; footer/labels ≥ 26 px.

- [ ] **Step 1: Write failing tests**

```ts
// tests/render.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageSize } from "image-size";
import { escapeHtml, emphasize, slideHtml, type RenderInput } from "../src/render/editorial.js";
import { renderCarousel } from "../src/render/render.js";

// 1x1 JPEG
const PIXEL = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

const input: RenderInput = {
  content: {
    title: "Satürn'ün halkaları *yavaşça* yok oluyor",
    slides: [{ body: "Halkalar milyarlarca buz parçasından oluşur." }, { heading: "Buz yağmuru", body: "Parçalar gezegene doğru yağar." }],
    caption: "c", hashtags: [],
  },
  category: "solar_system",
  credit: "NASA/JPL-Caltech",
  image: PIXEL,
  aiImage: true,
};

describe("editorial html", () => {
  it("escapes html and turns *word* into an accent em", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
    expect(emphasize("bir *iki* üç")).toBe("bir <em>iki</em> üç");
    expect(emphasize("<b>*x*</b>")).toBe("&lt;b&gt;<em>x</em>&lt;/b&gt;");
  });

  it("cover shows headline, counter, category and AI badge", () => {
    const h = slideHtml("cover", input, 0, 4);
    expect(h).toContain("<em>yavaşça</em>");
    expect(h).toContain("01 / 04");
    expect(h).toContain("Güneş Sistemi");
    expect(h).toContain("AI görseli");
  });

  it("info slide uses roman numerals", () => {
    expect(slideHtml("info", input, 2, 4)).toContain("ii.");
  });
});

describe("renderCarousel", () => {
  it("renders cover + info slides + closing as 1080x1350 JPEGs under 8MB", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fc-render-"));
    const files = await renderCarousel(input, dir);
    expect(files.map((f) => f.split("/").pop())).toEqual(["01.jpg", "02.jpg", "03.jpg", "04.jpg"]);
    for (const f of files) {
      const buf = await readFile(f);
      expect(imageSize(buf)).toMatchObject({ width: 1080, height: 1350, type: "jpg" });
      expect((await stat(f)).size).toBeLessThan(8 * 1024 * 1024);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement src/render/editorial.ts**

```ts
import { ACCOUNT_HANDLE } from "../config.js";
import { CATEGORY_LABEL_TR, type CarouselContent, type Category } from "../types.js";

export interface RenderInput {
  content: CarouselContent;
  category: Category;
  credit: string;
  image: Buffer;
  aiImage: boolean;
}

const ROMAN = ["i", "ii", "iii", "iv", "v"];

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escape, then turn *word* into <em>word</em>. */
export function emphasize(s: string): string {
  return escapeHtml(s).replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Font CSS files are linked by absolute file:// URL so Chromium loads latin + latin-ext (Turkish) subsets. */
const FONT_CSS = [
  "@fontsource/instrument-serif/400.css",
  "@fontsource/instrument-serif/400-italic.css",
  "@fontsource/inter-tight/400.css",
  "@fontsource/inter-tight/500.css",
].map((p) => import.meta.resolve(p));

const STYLE = `
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1080px;height:1350px;background:#0b0c14;color:#fff;overflow:hidden}
  .slide{position:relative;width:1080px;height:1350px;overflow:hidden}
  .photo{position:absolute;inset:0;background:center/cover no-repeat url("bg.jpg")}
  .shade{position:absolute;inset:0;background:linear-gradient(to top,rgba(3,4,10,.94) 0%,rgba(3,4,10,.55) 38%,rgba(3,4,10,0) 70%)}
  .top{position:absolute;top:56px;left:64px;right:64px;display:flex;justify-content:space-between;
       font:500 28px/1 'Inter Tight';letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.86)}
  .badge{position:absolute;top:112px;right:64px;font:500 24px/1 'Inter Tight';letter-spacing:.12em;
         text-transform:uppercase;padding:12px 18px;border:1.5px solid rgba(255,255,255,.6);border-radius:999px;background:rgba(3,4,10,.5)}
  h1{position:absolute;left:64px;right:64px;bottom:196px;font:400 118px/1.0 'Instrument Serif';letter-spacing:-.01em}
  em{font-style:italic;color:#f1d7a6}
  .rule{position:absolute;left:64px;right:64px;bottom:140px;border-top:2px solid rgba(255,255,255,.4)}
  .foot{position:absolute;left:64px;right:64px;bottom:72px;display:flex;justify-content:space-between;
        font:400 28px/1 'Inter Tight';color:rgba(255,255,255,.82)}
  .num{position:absolute;top:168px;left:64px;font:italic 400 200px/1 'Instrument Serif';color:#f1d7a6}
  .heading{position:absolute;top:410px;left:64px;right:80px;font:500 30px/1.2 'Inter Tight';letter-spacing:.14em;text-transform:uppercase;color:#f1d7a6}
  .body{position:absolute;top:470px;left:64px;right:80px;font:400 64px/1.28 'Instrument Serif'}
  .strip{position:absolute;left:64px;right:64px;bottom:196px;height:300px;border-radius:8px;background:center/cover no-repeat url("bg.jpg")}
  .close-title{position:absolute;left:64px;right:64px;top:420px;font:400 132px/1.0 'Instrument Serif'}
  .close-sub{position:absolute;left:64px;right:64px;top:720px;font:400 40px/1.4 'Inter Tight';color:rgba(255,255,255,.86)}
`;

function page(body: string): string {
  const links = FONT_CSS.map((href) => `<link rel="stylesheet" href="${href}">`).join("");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">${links}<style>${STYLE}</style></head><body><div class="slide">${body}</div></body></html>`;
}

export function slideHtml(kind: "cover" | "info" | "closing", input: RenderInput, index: number, total: number): string {
  const top = `<div class="top"><span>finducosmos</span><span>${pad(index + 1)} / ${pad(total)}</span></div>`;
  const credit = escapeHtml(input.credit);

  if (kind === "cover") {
    return page(`
      <div class="photo"></div><div class="shade"></div>${top}
      ${input.aiImage ? `<div class="badge">AI görseli</div>` : ""}
      <h1>${emphasize(input.content.title)}</h1>
      <div class="rule"></div>
      <div class="foot"><span>${escapeHtml(CATEGORY_LABEL_TR[input.category])}</span><span>kaydır →</span></div>`);
  }

  if (kind === "info") {
    const slide = input.content.slides[index - 1];
    return page(`
      ${top}
      <div class="num">${ROMAN[index - 1]}.</div>
      ${slide.heading ? `<div class="heading">${escapeHtml(slide.heading)}</div>` : ""}
      <div class="body">${emphasize(slide.body)}</div>
      <div class="strip"></div>
      <div class="rule"></div>
      <div class="foot"><span>📷 ${credit}</span><span>→</span></div>`);
  }

  return page(`
    <div class="photo" style="opacity:.35"></div>${top}
    <div class="close-title">Kaydet &amp; <em>takip et</em></div>
    <div class="close-sub">Her gün evrenden bir hikâye.<br>${escapeHtml(ACCOUNT_HANDLE)}</div>
    <div class="rule"></div>
    <div class="foot"><span>📷 ${credit}</span><span>Kaynak: NASA</span></div>`);
}
```

- [ ] **Step 4: Implement src/render/render.ts**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { slideHtml, type RenderInput } from "./editorial.js";

export async function renderCarousel(input: RenderInput, outDir: string): Promise<string[]> {
  const dir = resolve(outDir);
  const htmlDir = join(dir, "html");
  await mkdir(htmlDir, { recursive: true });
  await writeFile(join(htmlDir, "bg.jpg"), input.image);

  const kinds: ("cover" | "info" | "closing")[] = ["cover", ...input.content.slides.map(() => "info" as const), "closing"];
  const total = kinds.length;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    const out: string[] = [];
    for (let i = 0; i < total; i++) {
      const htmlPath = join(htmlDir, `${String(i + 1).padStart(2, "0")}.html`);
      await writeFile(htmlPath, slideHtml(kinds[i], input, i, total), "utf8");
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const jpg = join(dir, `${String(i + 1).padStart(2, "0")}.jpg`);
      await page.screenshot({ path: jpg, type: "jpeg", quality: 90, clip: { x: 0, y: 0, width: 1080, height: 1350 } });
      out.push(jpg);
    }
    return out;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/render.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Visual check with a real photo**

Run:
```bash
curl -sL -o /tmp/fc-sample.jpg "https://images-assets.nasa.gov/image/PIA21046/PIA21046~large.jpg"
npx tsx -e 'import {readFileSync} from "node:fs"; import {renderCarousel} from "./src/render/render.ts"; renderCarousel({content:{title:"Satürn'"'"'ün halkaları *yavaşça* yok oluyor",slides:[{body:"Halkalar milyarlarca buz parçasından oluşur ve gezegene doğru yağar."},{heading:"Buz yağmuru",body:"Cassini, halkalardan Satürn'"'"'e düşen malzemeyi gözlemledi."}],caption:"",hashtags:[]},category:"solar_system",credit:"NASA/JPL-Caltech/Space Science Institute",image:readFileSync("/tmp/fc-sample.jpg"),aiImage:false},"/tmp/fc-sample-out").then(f=>console.log(f.join("\n")))'
```
Open each JPEG with the Read tool. Check: Turkish letters (ş, ğ, ı, İ, ü) render in Instrument Serif (not a fallback serif), headline does not overflow, italic word is cream, footer readable. Fix CSS in `editorial.ts` if not, re-run Step 5.

- [ ] **Step 7: Commit**

```bash
git add src/render tests/render.test.ts
git commit -m "feat: add editorial carousel renderer (1080x1350 JPEG)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Instagram Graph API client (publish + token refresh)

**Files:**
- Create: `src/instagram.ts`
- Test: `tests/instagram.test.ts`

**Interfaces:**
- Consumes: `withRetry`, `IG_API_VERSION` (Task 1)
- Produces:
  - `interface InstagramClient { publishCarousel(imageUrls: string[], caption: string): Promise<{ mediaId: string; permalink?: string }>; refreshToken(): Promise<{ token: string; expiresIn: number }> }`
  - `createInstagramClient(opts: { userId: string; token: string; fetchFn?: typeof fetch; pollMs?: number; maxPolls?: number }): InstagramClient`

- [ ] **Step 1: Write failing tests**

```ts
// tests/instagram.test.ts
import { describe, it, expect } from "vitest";
import { createInstagramClient } from "../src/instagram.js";

type Call = { method: string; url: URL; body: URLSearchParams | null };

function fakeFetch(handler: (c: Call) => unknown) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? "GET", url: new URL(String(input)), body: init?.body ? new URLSearchParams(String(init.body)) : null };
    calls.push(c);
    return new Response(JSON.stringify(handler(c)), { status: 200 });
  }) as typeof fetch;
  return { fn, calls };
}

describe("publishCarousel", () => {
  it("creates children, carousel, waits for FINISHED, publishes, fetches permalink", async () => {
    let child = 0;
    let polls = 0;
    const { fn, calls } = fakeFetch((c) => {
      const p = c.url.pathname;
      if (p.endsWith("/U1/media") && c.body?.get("is_carousel_item") === "true") return { id: `c${++child}` };
      if (p.endsWith("/U1/media") && c.body?.get("media_type") === "CAROUSEL") return { id: "car" };
      if (p.endsWith("/car")) return { status_code: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" };
      if (p.endsWith("/U1/media_publish")) return { id: "M9" };
      if (p.endsWith("/M9")) return { permalink: "https://instagram.com/p/x" };
      throw new Error("unexpected " + p);
    });
    const ig = createInstagramClient({ userId: "U1", token: "T", fetchFn: fn, pollMs: 1 });
    const r = await ig.publishCarousel(["https://a/1.jpg", "https://a/2.jpg"], "cap");
    expect(r).toEqual({ mediaId: "M9", permalink: "https://instagram.com/p/x" });
    const carousel = calls.find((c) => c.body?.get("media_type") === "CAROUSEL")!;
    expect(carousel.body!.get("children")).toBe("c1,c2");
    expect(carousel.body!.get("caption")).toBe("cap");
    expect(calls.every((c) => (c.body?.get("access_token") ?? c.url.searchParams.get("access_token")) === "T")).toBe(true);
    expect(calls[0].url.hostname).toBe("graph.instagram.com");
  });

  it("rejects fewer than 2 or more than 10 images", async () => {
    const ig = createInstagramClient({ userId: "U1", token: "T", fetchFn: fakeFetch(() => ({})).fn });
    await expect(ig.publishCarousel(["a"], "c")).rejects.toThrow("2-10");
  });

  it("fails when the container reports ERROR", async () => {
    const { fn } = fakeFetch((c) => (c.url.pathname.endsWith("/car") ? { status_code: "ERROR" } : { id: c.body?.get("media_type") === "CAROUSEL" ? "car" : "c" }));
    const ig = createInstagramClient({ userId: "U1", token: "T", fetchFn: fn, pollMs: 1 });
    await expect(ig.publishCarousel(["a", "b"], "c")).rejects.toThrow("ERROR");
  });
});

describe("refreshToken", () => {
  it("calls refresh_access_token and returns the new token", async () => {
    const { fn, calls } = fakeFetch(() => ({ access_token: "NEW", expires_in: 5184000 }));
    const ig = createInstagramClient({ userId: "U1", token: "OLD", fetchFn: fn });
    expect(await ig.refreshToken()).toEqual({ token: "NEW", expiresIn: 5184000 });
    expect(calls[0].url.pathname).toBe("/refresh_access_token");
    expect(calls[0].url.searchParams.get("grant_type")).toBe("ig_refresh_token");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/instagram.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/instagram.ts**

```ts
import { IG_API_VERSION } from "./config.js";
import { withRetry } from "./retry.js";

export interface InstagramClient {
  publishCarousel(imageUrls: string[], caption: string): Promise<{ mediaId: string; permalink?: string }>;
  refreshToken(): Promise<{ token: string; expiresIn: number }>;
}

export function createInstagramClient(opts: {
  userId: string;
  token: string;
  fetchFn?: typeof fetch;
  pollMs?: number;
  maxPolls?: number;
}): InstagramClient {
  const fetchFn = opts.fetchFn ?? fetch;
  const base = `https://graph.instagram.com/${IG_API_VERSION}`;
  const pollMs = opts.pollMs ?? 5000;
  const maxPolls = opts.maxPolls ?? 24; // ~2 minutes

  async function call<T>(method: "GET" | "POST", url: string, params: Record<string, string>, label: string, attempts = 3): Promise<T> {
    return withRetry(async () => {
      const all = { ...params, access_token: opts.token };
      const res =
        method === "GET"
          ? await fetchFn(`${url}?${new URLSearchParams(all)}`)
          : await fetchFn(url, { method: "POST", body: new URLSearchParams(all) });
      const json = (await res.json()) as T & { error?: { message?: string } };
      if (!res.ok || json.error) throw new Error(`Instagram ${label}: ${json.error?.message ?? `HTTP ${res.status}`}`);
      return json;
    }, { label: `Instagram ${label}`, baseMs: 2000, attempts });
  }

  return {
    async publishCarousel(imageUrls, caption) {
      if (imageUrls.length < 2 || imageUrls.length > 10) throw new Error(`Carousel needs 2-10 images, got ${imageUrls.length}`);
      const children: string[] = [];
      for (const image_url of imageUrls) {
        const { id } = await call<{ id: string }>("POST", `${base}/${opts.userId}/media`, { image_url, is_carousel_item: "true" }, "create item");
        children.push(id);
      }
      const { id: carouselId } = await call<{ id: string }>(
        "POST", `${base}/${opts.userId}/media`,
        { media_type: "CAROUSEL", children: children.join(","), caption }, "create carousel");

      for (let i = 0; ; i++) {
        const { status_code } = await call<{ status_code: string }>("GET", `${base}/${carouselId}`, { fields: "status_code" }, "status");
        if (status_code === "FINISHED") break;
        if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`Instagram container status ${status_code}`);
        if (i >= maxPolls) throw new Error("Instagram container not ready after polling");
        await new Promise((r) => setTimeout(r, pollMs));
      }

      // Single attempt: retrying a publish that succeeded but timed out would double post.
      const { id: mediaId } = await call<{ id: string }>("POST", `${base}/${opts.userId}/media_publish`, { creation_id: carouselId }, "publish", 1);
      let permalink: string | undefined;
      try {
        ({ permalink } = await call<{ permalink?: string }>("GET", `${base}/${mediaId}`, { fields: "permalink" }, "permalink"));
      } catch {
        // Post is already live; a missing permalink must not fail the run.
      }
      return { mediaId, permalink };
    },

    async refreshToken() {
      const r = await call<{ access_token: string; expires_in: number }>(
        "GET", "https://graph.instagram.com/refresh_access_token", { grant_type: "ig_refresh_token" }, "refresh token");
      return { token: r.access_token, expiresIn: r.expires_in };
    },
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/instagram.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/instagram.ts tests/instagram.test.ts
git commit -m "feat: add Instagram Graph API carousel publisher and token refresh

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Git helper and daily pipeline (main.ts)

**Files:**
- Create: `src/git.ts`, `src/pipeline.ts`, `src/main.ts`
- Test: `tests/pipeline.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `commitAndPush(paths: string[], message: string): string` → returns HEAD sha (src/git.ts)
  - `rawUrl(repo: string, sha: string, path: string): string` (src/git.ts)
  - `waitForUrl(url: string, fetchFn?: typeof fetch, tries?: number, delayMs?: number): Promise<void>` (src/git.ts)
  - `interface PipelineDeps { askJson; nasa; imageModel; instagram: InstagramClient | null; render: typeof renderCarousel; git: { commitAndPush; rawUrl; waitForUrl }; repo: string; now: Date; root: string; dryRun: boolean }`
  - `runDailyPipeline(deps: PipelineDeps): Promise<{ status: "skipped" | "dry_run" | "published"; date: string; files: string[] }>` (src/pipeline.ts)

- [ ] **Step 1: Implement src/git.ts**

```ts
import { execFileSync } from "node:child_process";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

export function commitAndPush(paths: string[], message: string): string {
  git("config", "user.name", "github-actions[bot]");
  git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
  git("add", "--", ...paths);
  git("commit", "-m", message);
  git("push");
  return git("rev-parse", "HEAD");
}

export function rawUrl(repo: string, sha: string, path: string): string {
  return `https://raw.githubusercontent.com/${repo}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** raw.githubusercontent.com can lag a few seconds after a push. */
export async function waitForUrl(url: string, fetchFn: typeof fetch = fetch, tries = 10, delayMs = 3000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const res = await fetchFn(url, { method: "HEAD" });
    if (res.ok) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Image URL not reachable after push: ${url}`);
}
```

- [ ] **Step 2: Write failing pipeline tests**

```ts
// tests/pipeline.test.ts
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
  const askJson = vi.fn(async ({ schema }: any) => {
    const keys = Object.keys(schema.shape);
    if (keys.includes("searchQueryEn")) return { category: "solar_system", titleTr: "Satürn", searchQueryEn: "saturn", useApod: false };
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
    expect(history).toEqual([{ date: "2026-11-21", category: "solar_system", title: "Satürn", status: "published", mediaId: "M1", permalink: "https://ig/p" }]);
    expect(d.git.commitAndPush).toHaveBeenCalledTimes(2); // images, then history
    const contentJson = JSON.parse(await readFile(join(d.root, "posts/2026-11-21/content.json"), "utf8"));
    expect(contentJson.source.sourceUrl).toBe("https://images.nasa.gov/details/N1");
  });

  it("skips when today is already published", async () => {
    const d = await deps();
    await writeFile(join(d.root, "history.json"), JSON.stringify([{ date: "2026-11-21", category: "apod", title: "x", status: "published", mediaId: "M0" }]));
    const r = await runDailyPipeline(d);
    expect(r.status).toBe("skipped");
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
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement src/pipeline.ts**

```ts
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
```

Note: `render` writes `html/` helper files inside `outDir`; they are not committed (only JPEGs + content.json are added). Add `posts/*/html/` to `.gitignore` in Step 6.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/pipeline.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Implement src/main.ts and ignore render scratch files**

```ts
// src/main.ts
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
```

```bash
echo "posts/*/html/" >> .gitignore
```

`createAskJson()` reads `ANTHROPIC_API_KEY` from the environment through the SDK default.

- [ ] **Step 7: Run full suite**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/git.ts src/pipeline.ts src/main.ts tests/pipeline.test.ts .gitignore
git commit -m "feat: wire the daily pipeline with dry-run and double-post guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: GitHub Actions workflows and token refresh entry point

**Files:**
- Create: `src/refresh-token.ts`, `.github/workflows/daily.yml`, `.github/workflows/refresh-token.yml`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `createInstagramClient` (Task 8), `requireEnv` (Task 1), `npm run post` (Task 9)
- Produces: workflows `daily-post`, `refresh-ig-token`, `ci`; repository variable `ENABLE_SCHEDULE` gates the cron.

- [ ] **Step 1: Implement src/refresh-token.ts**

```ts
import { appendFileSync } from "node:fs";
import { requireEnv } from "./config.js";
import { createInstagramClient } from "./instagram.js";

const ig = createInstagramClient({ userId: "me", token: requireEnv("IG_ACCESS_TOKEN") });
const { token, expiresIn } = await ig.refreshToken();
// Mask before anything else can print it, then hand it to the next step via GITHUB_OUTPUT.
console.log(`::add-mask::${token}`);
appendFileSync(requireEnv("GITHUB_OUTPUT"), `token=${token}\n`);
console.log(`Token refreshed; expires in ${Math.round(expiresIn / 86400)} days.`);
```

- [ ] **Step 2: Create .github/workflows/daily.yml**

```yaml
name: daily-post
on:
  schedule:
    - cron: "0 16 * * *" # 19:00 Europe/Istanbul
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Render only, do not publish"
        type: boolean
        default: true
permissions:
  contents: write
concurrency:
  group: daily-post
  cancel-in-progress: false
jobs:
  post:
    # Cron stays off until the repo variable ENABLE_SCHEDULE is set to "true" (see SETUP.md).
    if: github.event_name != 'schedule' || vars.ENABLE_SCHEDULE == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run post
        env:
          DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run || 'false' }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          NASA_API_KEY: ${{ secrets.NASA_API_KEY }}
          IG_USER_ID: ${{ secrets.IG_USER_ID }}
          IG_ACCESS_TOKEN: ${{ secrets.IG_ACCESS_TOKEN }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: carousel-${{ github.run_id }}
          path: posts/
          if-no-files-found: ignore
```

- [ ] **Step 3: Create .github/workflows/refresh-token.yml**

```yaml
name: refresh-ig-token
on:
  schedule:
    - cron: "0 3 * * 1" # Mondays 06:00 Istanbul
  workflow_dispatch:
permissions:
  contents: read
jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - id: refresh
        run: npm run refresh-token
        env:
          IG_ACCESS_TOKEN: ${{ secrets.IG_ACCESS_TOKEN }}
      - name: Save new token as secret
        run: gh secret set IG_ACCESS_TOKEN --repo "$GITHUB_REPOSITORY" --body "$NEW_TOKEN"
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
          NEW_TOKEN: ${{ steps.refresh.outputs.token }}
```

- [ ] **Step 4: Create .github/workflows/ci.yml**

```yaml
name: ci
on:
  push:
    branches-ignore: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run typecheck
      - run: npm test
```

- [ ] **Step 5: Lint workflows and typecheck**

Run: `npm run typecheck && npx --yes @action-validator/cli .github/workflows/daily.yml && npx --yes @action-validator/cli .github/workflows/refresh-token.yml && npx --yes @action-validator/cli .github/workflows/ci.yml`
Expected: no errors. (If the validator package is unavailable, skip it and rely on Task 12's live run.)

- [ ] **Step 6: Commit**

```bash
git add src/refresh-token.ts .github
git commit -m "ci: add daily post, token refresh and test workflows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Setup guide and README

**Files:**
- Create: `SETUP.md`, `README.md` (replace the one-line README)

**Interfaces:**
- Consumes: secret names (Task 10), `ENABLE_SCHEDULE` variable (Task 10), `dry_run` input (Task 10).

- [ ] **Step 1: Write SETUP.md (Turkish)**

```markdown
# Kurulum

Bu rehber bir kez yapılır. Sıra önemlidir.

## 1. Anahtarları al

| Secret | Nereden |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `GEMINI_API_KEY` | aistudio.google.com → Get API key |
| `NASA_API_KEY` | api.nasa.gov → Generate API Key (ücretsiz) |

## 2. Instagram API (Instagram Login)

1. Hesabın Creator veya Business olmalı (Ayarlar → Hesap türü).
2. developers.facebook.com → **Uygulama oluştur** → kullanım: "Diğer" → tür: **Business**.
3. Uygulamaya **Instagram** ürününü ekle → "API setup with Instagram login".
4. "Generate access tokens" bölümünde Instagram hesabını ekle ve **token oluştur**. Bu kısa ömürlü değil, 60 günlük uzun ömürlü token'dır; kopyala.
5. İzinler: `instagram_business_basic`, `instagram_business_content_publish`.
6. IG kullanıcı ID'ni al:
   ```bash
   curl "https://graph.instagram.com/v23.0/me?fields=user_id,username&access_token=TOKEN"
   ```
   Dönen `user_id` → `IG_USER_ID`. Token → `IG_ACCESS_TOKEN`.
7. Uygulama "Development" modunda kalabilir; kendi hesabına paylaşım için yeterlidir.

## 3. Token yenileme için PAT

github.com/settings/personal-access-tokens → **Fine-grained token** → yalnızca `finducosmos` reposu → Repository permissions → **Secrets: Read and write**. Süreyi 1 yıl seç; dolmadan yenile. → `GH_PAT`.

## 4. Secret'ları ekle

Repo → Settings → Secrets and variables → Actions → **New repository secret**: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `NASA_API_KEY`, `IG_USER_ID`, `IG_ACCESS_TOKEN`, `GH_PAT`.

## 5. Deneme (paylaşmaz)

Actions → **daily-post** → Run workflow → `dry_run` işaretli → çalıştır. Bitince **Artifacts** altındaki `carousel-…` zip'ini indir, kartlara bak.

## 6. Repoyu public yap

Instagram görselleri herkese açık URL'den çeker. Settings → General → Danger Zone → Change visibility → Public. (Secret'lar görünmez.)

## 7. İlk gerçek paylaşım

Actions → daily-post → Run workflow → `dry_run` **işaretsiz**. Instagram'da gönderiyi kontrol et.

## 8. Günlük otomasyonu aç

Settings → Secrets and variables → Actions → **Variables** → `ENABLE_SCHEDULE` = `true`. Artık her gün 19:00'da paylaşır. Kapatmak için `false` yap.

## Sorun giderme

- Workflow kırmızıysa GitHub e-posta atar; o gün paylaşım yapılmamıştır. Logda hangi adımın düştüğü yazar.
- "failed fact verification" → içerik kaynakla uyuşmadı; bilerek paylaşılmadı. Elle tekrar çalıştırabilirsin.
- Token hatası → Actions → refresh-ig-token → Run workflow. O da düşerse 2. adımı tekrarla.
```

- [ ] **Step 2: Write README.md**

```markdown
# finducosmos

Her gün NASA kaynaklı, Türkçe bir uzay carousel'i üretip Instagram'a paylaşan GitHub Actions otomasyonu.

- Konu ve metin: Claude · Görsel: NASA APOD / NASA Image Library (yoksa Gemini) · Kart: Playwright
- Her bilgi NASA kaynak metniyle doğrulanır; doğrulanamazsa o gün paylaşım yapılmaz.
- Paylaşılan her gün `posts/YYYY-MM-DD/` altında, geçmiş `history.json` içinde.

Kurulum: [SETUP.md](SETUP.md) · Tasarım: [docs/superpowers/specs](docs/superpowers/specs)

```bash
npm ci && npx playwright install chromium
npm test
DRY_RUN=true GITHUB_REPOSITORY=mcozcn/finducosmos ANTHROPIC_API_KEY=… GEMINI_API_KEY=… NASA_API_KEY=… npm run post
```
```

- [ ] **Step 3: Commit**

```bash
git add SETUP.md README.md
git commit -m "docs: add setup guide and README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Go-live checklist (needs the user at each gate)

No new code. Each step requires explicit user approval in chat before it runs.

- [ ] **Step 1:** Push the branch and open a PR (user approval). Confirm `ci` workflow is green.
- [ ] **Step 2:** User completes SETUP.md sections 1–4. Verify with `gh secret list --repo mcozcn/finducosmos` (names only).
- [ ] **Step 3:** Merge the PR to `main` (user approval) — scheduled and dispatch workflows run from the default branch.
- [ ] **Step 4:** Run `gh workflow run daily-post -f dry_run=true`; download the artifact; inspect every JPEG with the Read tool and `content.json` for grounding. Fix and repeat until the cards look right.
- [ ] **Step 5:** With user approval, make the repo public: `gh repo edit mcozcn/finducosmos --visibility public --accept-visibility-change-consequences`.
- [ ] **Step 6:** With user approval, run `gh workflow run daily-post -f dry_run=false`. Verify the post on Instagram and the new `history.json` commit. If Instagram rejects the raw.githubusercontent URL, switch `rawUrl` to GitHub Pages (`https://mcozcn.github.io/finducosmos/<path>`) and enable Pages from `main`.
- [ ] **Step 7:** Run `gh workflow run refresh-ig-token` once and confirm it is green.
- [ ] **Step 8:** With user approval, `gh variable set ENABLE_SCHEDULE --body true --repo mcozcn/finducosmos`.
