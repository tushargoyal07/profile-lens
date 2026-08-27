import { ConfigError } from "./errors.js";
import { parseCookieHeader } from "./linkedin/cookies.js";

export interface Config {
  linkedinCookies: Record<string, string>;
  linkedinEmail: string | null;
  linkedinPassword: string | null;
  apiKey: string | null;
  port: number;
  rateLimitPerMinute: number;
  cacheTtlSeconds: number;
  requestTimeoutMs: number;
  linkedinMinIntervalMs: number;
  profileCooldownMs: number;
  logLevel: string;
}

function optional(value: string | undefined): string | null {
  let trimmed = value?.trim() ?? "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1);
  }
  return trimmed ? trimmed : null;
}

function integer(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ConfigError(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

export function cookiesFromEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const header = optional(env.LINKEDIN_COOKIE);
  const cookies = header ? parseCookieHeader(header) : {};
  const liAt = optional(env.LINKEDIN_LI_AT);
  if (liAt) {
    cookies.li_at = liAt.includes("=") ? (parseCookieHeader(liAt).li_at ?? liAt) : liAt;
  }
  const jsession = optional(env.LINKEDIN_JSESSIONID);
  if (jsession) {
    cookies.JSESSIONID = jsession;
  }
  return cookies;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const linkedinCookies = cookiesFromEnv(env);
  const linkedinEmail = optional(env.LINKEDIN_EMAIL);
  const linkedinPassword = optional(env.LINKEDIN_PASSWORD);
  if (!linkedinCookies.li_at && !(linkedinEmail && linkedinPassword)) {
    throw new ConfigError(
      "Missing LinkedIn session. Set LINKEDIN_LI_AT (or LINKEDIN_COOKIE) from a browser you own, or set LINKEDIN_EMAIL and LINKEDIN_PASSWORD.",
    );
  }
  return {
    linkedinCookies,
    linkedinEmail,
    linkedinPassword,
    apiKey: optional(env.API_KEY),
    port: integer("PORT", env.PORT, 8080),
    rateLimitPerMinute: integer("RATE_LIMIT_PER_MINUTE", env.RATE_LIMIT_PER_MINUTE, 10),
    cacheTtlSeconds: integer("CACHE_TTL_SECONDS", env.CACHE_TTL_SECONDS, 600),
    requestTimeoutMs: integer("REQUEST_TIMEOUT_MS", env.REQUEST_TIMEOUT_MS, 20_000),
    linkedinMinIntervalMs: integer(
      "LINKEDIN_MIN_INTERVAL_MS",
      env.LINKEDIN_MIN_INTERVAL_MS,
      1000,
    ),
    profileCooldownMs: integer("PROFILE_COOLDOWN_MS", env.PROFILE_COOLDOWN_MS, 8000),
    logLevel: optional(env.LOG_LEVEL) ?? "info",
  };
}

export function normalizeJsessionId(raw: string): {
  cookieValue: string;
  csrfToken: string;
} {
  let value = raw.trim().replace(/^"+|"+$/g, "");
  if (!value.startsWith("ajax:")) {
    value = `ajax:${value.replace(/^ajax:?/, "")}`;
  }
  return {
    cookieValue: `"${value}"`,
    csrfToken: value,
  };
}
