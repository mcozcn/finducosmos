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
