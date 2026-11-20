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
