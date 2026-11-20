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
