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
