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
