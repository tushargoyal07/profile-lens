import { Impit } from "impit";
import type { Config } from "../config.js";
import { normalizeJsessionId } from "../config.js";
import {
  SessionExpiredError,
  UpstreamBlockedError,
  UpstreamError,
  UpstreamRateLimitedError,
} from "../errors.js";
import { isObject, type JsonObject } from "../lib/json.js";

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
  private readonly impit: Impit;
  private readonly cookieHeader: string;
  private readonly csrfToken: string;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;

  constructor(config: Config) {
    const session = normalizeJsessionId(config.linkedinJsessionId);
    this.csrfToken = session.csrfToken;
    this.cookieHeader = `li_at=${config.linkedinLiAt}; JSESSIONID=${session.cookieValue}`;
    this.minIntervalMs = config.linkedinMinIntervalMs;
    this.impit = new Impit({
      browser: "chrome",
      timeout: config.requestTimeoutMs,
      followRedirects: true,
    });
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

  private async getJson(path: string, publicIdentifier?: string): Promise<JsonObject> {
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
          cookie: this.cookieHeader,
          referer,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "LinkedIn request failed";
      throw new UpstreamError(message);
    }

    if (response.status === 401 || response.status === 403) {
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
