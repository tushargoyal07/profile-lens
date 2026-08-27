import type { ProfileResponse } from "../api/schemas.js";
import type { Config } from "../config.js";
import { parseProfileUrl } from "../domain/url.js";
import {
  LoginError,
  SessionExpiredError,
  UpstreamBlockedError,
  UpstreamRateLimitedError,
} from "../errors.js";
import { isObject, type JsonObject } from "../lib/json.js";
import { DASH_DECORATIONS, type LinkedInClient } from "../linkedin/client.js";
import {
  isThinProfile,
  mergeProfiles,
  parseDashProfile,
  parseProfileView,
  parseSkillsPayload,
} from "../linkedin/parser.js";
import { TtlCache } from "./limits.js";
import { readProfileCache, writeProfileCacheEntry } from "./profile-cache.js";

export class ProfileService {
  private readonly cache: TtlCache<ProfileResponse>;
  private readonly cooldownMs: number;
  private lastLookupAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly client: LinkedInClient,
    config: Config,
  ) {
    this.cache = new TtlCache(config.cacheTtlSeconds * 1000);
    this.cooldownMs = config.profileCooldownMs;
  }

  async lookup(rawUrl: string): Promise<ProfileResponse> {
    const run = this.queue.then(() => this.lookupOne(rawUrl));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async lookupOne(rawUrl: string): Promise<ProfileResponse> {
    const ref = parseProfileUrl(rawUrl);
    const key = ref.publicIdentifier.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    const disk = await readProfileCache();
    if (disk[key]) {
      this.cache.set(key, disk[key]);
      return disk[key];
    }

    const wait = this.cooldownMs - (Date.now() - this.lastLookupAt);
    if (this.lastLookupAt > 0 && wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }

    const sources: string[] = [];
    let parsed: Partial<ProfileResponse> | null = null;

    const dash = await this.fetchDash(ref.publicIdentifier, sources);
    if (dash) {
      parsed = parseDashProfile(dash, ref.publicIdentifier);
    }

    if (isThinProfile(parsed)) {
      const view = await this.safe(() => this.client.getProfileView(ref.publicIdentifier));
      if (view && view.status !== 404 && view.status !== 403) {
        sources.push("identity.profiles.profileView");
        parsed = mergeProfiles(parsed ?? {}, parseProfileView(view, ref.publicIdentifier));
      }
    }

    this.lastLookupAt = Date.now();

    if (!parsed?.profile) {
      throw new SessionExpiredError(
        "LinkedIn used up this session after a previous lookup (one live scrape per cookie is typical). Paste a fresh li_at and JSESSIONID for a new profile. Profiles already fetched are served from cache without calling LinkedIn.",
      );
    }

    let profile = parsed.profile;

    if (!parsed.skills?.length) {
      const skills = await this.safe(() => this.client.getSkills(ref.publicIdentifier));
      if (skills && skills.status !== 404 && skills.status !== 403) {
        sources.push("identity.profiles.skills");
        parsed = { ...parsed, skills: parseSkillsPayload(skills) };
      }
    }

    const result: ProfileResponse = {
      input: {
        url: ref.originalUrl,
        publicIdentifier: ref.publicIdentifier,
      },
      profile,
      experience: parsed.experience ?? [],
      education: parsed.education ?? [],
      skills: parsed.skills ?? [],
      certifications: parsed.certifications ?? [],
      languages: parsed.languages ?? [],
      volunteer: parsed.volunteer ?? [],
      meta: {
        fetchedAt: new Date().toISOString(),
        sources,
        partial:
          !(parsed.experience?.length) ||
          !(parsed.education?.length) ||
          !(parsed.skills?.length),
      },
    };

    this.cache.set(ref.publicIdentifier.toLowerCase(), result);
    await writeProfileCacheEntry(ref.publicIdentifier, result);
    return result;
  }

  private async fetchDash(
    publicIdentifier: string,
    sources: string[],
  ): Promise<JsonObject | null> {
    for (const decoration of DASH_DECORATIONS) {
      const body = await this.safe(() =>
        this.client.getDashProfile(publicIdentifier, decoration),
      );
      if (!body || body.status === 404 || body.status === 403) {
        continue;
      }
      sources.push(`identity.dash.profiles:${decoration.split(".").pop()}`);
      return body;
    }
    return null;
  }

  private async safe(fn: () => Promise<JsonObject>): Promise<JsonObject | null> {
    try {
      const body = await fn();
      return isObject(body) ? body : null;
    } catch (error) {
      if (
        error instanceof SessionExpiredError ||
        error instanceof LoginError ||
        error instanceof UpstreamBlockedError ||
        error instanceof UpstreamRateLimitedError
      ) {
        throw error;
      }
      return null;
    }
  }
}
