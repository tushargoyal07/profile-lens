import { ConfigError } from "./errors.js";

export interface Config {
  linkedinLiAt: string;
  linkedinJsessionId: string;
  apiKey: string | null;
  port: number;
  rateLimitPerMinute: number;
  cacheTtlSeconds: number;
  requestTimeoutMs: number;
  linkedinMinIntervalMs: number;
  logLevel: string;
}

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new ConfigError(
      `Missing ${name}. Copy .env.example to .env and add your LinkedIn cookies.`,
    );
  }
  return trimmed;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    linkedinLiAt: required("LINKEDIN_LI_AT", env.LINKEDIN_LI_AT),
    linkedinJsessionId: required("LINKEDIN_JSESSIONID", env.LINKEDIN_JSESSIONID),
    apiKey: env.API_KEY?.trim() || null,
    port: integer("PORT", env.PORT, 8080),
    rateLimitPerMinute: integer("RATE_LIMIT_PER_MINUTE", env.RATE_LIMIT_PER_MINUTE, 10),
    cacheTtlSeconds: integer("CACHE_TTL_SECONDS", env.CACHE_TTL_SECONDS, 600),
    requestTimeoutMs: integer("REQUEST_TIMEOUT_MS", env.REQUEST_TIMEOUT_MS, 20_000),
    linkedinMinIntervalMs: integer(
      "LINKEDIN_MIN_INTERVAL_MS",
      env.LINKEDIN_MIN_INTERVAL_MS,
      250,
    ),
    logLevel: env.LOG_LEVEL?.trim() || "info",
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

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    linkedinLiAt: "test-li-at",
    linkedinJsessionId: "ajax:1",
    apiKey: null,
    port: 8080,
    rateLimitPerMinute: 60,
    cacheTtlSeconds: 0,
    requestTimeoutMs: 5000,
    linkedinMinIntervalMs: 0,
    logLevel: "error",
    ...overrides,
  };
}
