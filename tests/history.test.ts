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
