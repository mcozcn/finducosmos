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
        const res = await fetchFn(url, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status} downloading image`);
        return Buffer.from(await res.arrayBuffer());
      }, { label: "NASA image download" });
    },
  };
}
