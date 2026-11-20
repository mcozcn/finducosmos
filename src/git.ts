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
