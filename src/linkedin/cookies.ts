/** Minimal cookie jar matching the subset Impit expects. Domain/path are ignored. */
export class MemoryCookieJar {
  private readonly byName = new Map<string, string>();

  setCookie(cookie: string, _url: string, cb?: (err?: Error | null) => void): void {
    try {
      const first = cookie.split(";")[0] ?? "";
      const eq = first.indexOf("=");
      if (eq !== -1) {
        const name = first.slice(0, eq).trim();
        const value = first.slice(eq + 1).trim();
        if (name) {
          this.byName.set(name, value);
        }
      }
      cb?.(null);
    } catch (error) {
      cb?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  getCookieString(_url: string): string {
    return [...this.byName.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  get(name: string): string | undefined {
    return this.byName.get(name);
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.byName);
  }

  load(cookies: Record<string, string>): void {
    for (const [name, value] of Object.entries(cookies)) {
      if (name && value) {
        this.byName.set(name, value);
      }
    }
  }

  clear(): void {
    this.byName.clear();
  }
}

const COOKIE_ATTRIBUTES = new Set([
  "path",
  "domain",
  "expires",
  "max-age",
  "secure",
  "httponly",
  "samesite",
  "priority",
  "partitioned",
]);

/** Parse a browser Cookie header, `li_at=…; JSESSIONID=…`, or a bare li_at value. */
export function parseCookieHeader(raw: string): Record<string, string> {
  const trimmed = raw.trim().replace(/^Cookie:\s*/i, "");
  if (!trimmed) {
    return {};
  }
  if (!trimmed.includes("=")) {
    return { li_at: trimmed };
  }

  const out: Record<string, string> = {};
  for (const part of trimmed.split(";")) {
    const piece = part.trim();
    if (!piece) {
      continue;
    }
    const eq = piece.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const name = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    if (!name || COOKIE_ATTRIBUTES.has(name.toLowerCase())) {
      continue;
    }
    out[name] = value;
  }
  return out;
}

export function ingestSetCookieHeaders(
  headers: Headers,
  url: string,
  jar: MemoryCookieJar,
): void {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const listed =
    typeof withGetSetCookie.getSetCookie === "function" ? withGetSetCookie.getSetCookie() : [];
  if (listed.length > 0) {
    for (const cookie of listed) {
      jar.setCookie(cookie, url);
    }
    return;
  }
  const combined = headers.get("set-cookie");
  if (combined) {
    jar.setCookie(combined, url);
  }
}
