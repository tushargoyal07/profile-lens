import { Impit } from "impit";
import type { Config } from "../config.js";
import { normalizeJsessionId } from "../config.js";
import {
  LoginError,
  SessionExpiredError,
  UpstreamBlockedError,
  UpstreamError,
  UpstreamRateLimitedError,
} from "../errors.js";
import { isObject, type JsonObject } from "../lib/json.js";
import { loginWithPassword } from "./auth.js";
import { MemoryCookieJar } from "./cookies.js";
import { loadStoredSession, saveStoredSession } from "./session-store.js";

const BASE = "https://www.linkedin.com/voyager/api";

export const DASH_DECORATIONS = [
  "com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93",
  "com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-85",
  "com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-73",
  "com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-16",
];

const TRACK = JSON.stringify({
  clientVersion: "1.13.33333",
  mpVersion: "1.13.33333",
  osName: "web",
  timezoneOffset: 5.5,
  timezone: "Asia/Kolkata",
  deviceFormFactor: "DESKTOP",
  displayWidth: 1920,
  displayHeight: 1080,
});

export class LinkedInClient {
  private readonly config: Config;
  private readonly jar: MemoryCookieJar;
  private readonly impit: Impit;
  private csrfToken = "";
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;
  private loginInFlight: Promise<void> | null = null;

  constructor(config: Config) {
    this.config = config;
    this.jar = new MemoryCookieJar();
    this.minIntervalMs = config.linkedinMinIntervalMs;
    this.impit = new Impit({
      browser: "chrome",
      timeout: config.requestTimeoutMs,
      followRedirects: true,
      cookieJar: this.jar,
    });
  }

  async authenticate(): Promise<void> {
    if (!this.loginInFlight) {
      this.loginInFlight = this.performLogin().finally(() => {
        this.loginInFlight = null;
      });
    }
    await this.loginInFlight;
  }

  async ping(): Promise<JsonObject> {
    return this.getJson("/me");
  }

  async getDashProfile(publicIdentifier: string, decorationId: string): Promise<JsonObject> {
    const params = new URLSearchParams({
      q: "memberIdentity",
      memberIdentity: publicIdentifier,
      decorationId,
    });
    return this.getJson(`/identity/dash/profiles?${params.toString()}`, publicIdentifier);
  }

  async getProfileView(publicIdentifier: string): Promise<JsonObject> {
    return this.getJson(
      `/identity/profiles/${encodeURIComponent(publicIdentifier)}/profileView`,
      publicIdentifier,
    );
  }

  async getSkills(publicIdentifier: string): Promise<JsonObject> {
    return this.getJson(
      `/identity/profiles/${encodeURIComponent(publicIdentifier)}/skills?count=100&start=0`,
      publicIdentifier,
    );
  }

  async getContactInfo(publicIdentifier: string): Promise<JsonObject> {
    return this.getJson(
      `/identity/profiles/${encodeURIComponent(publicIdentifier)}/profileContactInfo`,
      publicIdentifier,
    );
  }

  private async performLogin(): Promise<void> {
    if (this.config.linkedinCookies.li_at) {
      await this.authenticateWithCookies(this.config.linkedinCookies, "environment");
      return;
    }

    const stored = await loadStoredSession();
    if (stored?.li_at) {
      try {
        await this.authenticateWithCookies(stored, "data/linkedin-session.json");
        return;
      } catch {
        this.jar.clear();
        this.csrfToken = "";
      }
    }

    if (!this.config.linkedinEmail || !this.config.linkedinPassword) {
      throw new LoginError(
        "No usable LinkedIn cookie. Set LINKEDIN_LI_AT or LINKEDIN_COOKIE from a browser session you own.",
      );
    }

    const session = await loginWithPassword(
      this.impit,
      this.jar,
      this.config.linkedinEmail,
      this.config.linkedinPassword,
    );
    this.csrfToken = normalizeJsessionId(session.jsessionId).csrfToken;
    await saveStoredSession(this.jar.snapshot());
  }

  private async authenticateWithCookies(
    cookies: Record<string, string>,
    source: string,
  ): Promise<void> {
    this.jar.clear();
    this.jar.load(cookies);
    if (!(await this.hydrateCsrf())) {
      throw new LoginError(
        "Missing JSESSIONID. Copy it from the same browser session as li_at.",
      );
    }
    console.error(`LinkedIn cookies loaded from ${source} (first Voyager call is the profile request)`);
  }

  private async hydrateCsrf(): Promise<boolean> {
    const jsession = this.jar.get("JSESSIONID");
    if (!jsession) {
      return false;
    }
    this.csrfToken = normalizeJsessionId(jsession).csrfToken;
    return true;
  }

  private async probeSession(): Promise<boolean> {
    if (!this.csrfToken) {
      return false;
    }
    try {
      const response = await this.impit.fetch(`${BASE}/me`, {
        method: "GET",
        headers: {
          accept: "application/vnd.linkedin.normalized+json+2.1",
          "accept-language": "en-US,en;q=0.9",
          "csrf-token": this.csrfToken,
          "x-restli-protocol-version": "2.0.0",
          referer: "https://www.linkedin.com/feed/",
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async getJson(path: string, publicIdentifier?: string): Promise<JsonObject> {
    if (!this.csrfToken) {
      await this.authenticate();
    }
    await this.throttle();
    const url = `${BASE}${path}`;
    const referer = publicIdentifier
      ? `https://www.linkedin.com/in/${publicIdentifier}/`
      : "https://www.linkedin.com/feed/";

    let response;
    try {
      response = await this.impit.fetch(url, {
        method: "GET",
        headers: {
          accept: "application/vnd.linkedin.normalized+json+2.1",
          "accept-language": "en-US,en;q=0.9",
          "csrf-token": this.csrfToken,
          "x-restli-protocol-version": "2.0.0",
          "x-li-lang": "en_US",
          "x-li-track": TRACK,
          referer,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "LinkedIn request failed";
      throw new UpstreamError(message);
    }

    if (response.status === 401) {
      throw new SessionExpiredError();
    }
    if (response.status === 403) {
      if (path === "/me" || path.endsWith("/me")) {
        throw new SessionExpiredError();
      }
      if (await this.probeSession()) {
        return { status: 403 };
      }
      throw new SessionExpiredError();
    }
    if (response.status === 429) {
      throw new UpstreamRateLimitedError();
    }
    if (response.status === 999) {
      throw new UpstreamBlockedError();
    }
    if (response.status === 404) {
      return { status: 404 };
    }
    if (!response.ok) {
      throw new UpstreamError(`LinkedIn returned HTTP ${response.status} for ${path}`);
    }

    const body: unknown = await response.json();
    if (!isObject(body)) {
      throw new UpstreamError("LinkedIn returned a non-object JSON body.");
    }
    return body;
  }

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) {
      return;
    }
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minIntervalMs - elapsed));
    }
    this.lastRequestAt = Date.now();
  }
}
