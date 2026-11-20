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
