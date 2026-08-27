import type { ProfileResponse } from "../api/schemas.js";
import type { Config } from "../config.js";
import { parseProfileUrl } from "../domain/url.js";
import {
  ProfileNotFoundError,
  SessionExpiredError,
  UpstreamBlockedError,
  UpstreamRateLimitedError,
} from "../errors.js";
import { isObject, type JsonObject } from "../lib/json.js";
import { DASH_DECORATIONS, type LinkedInClient } from "../linkedin/client.js";
import {
  isThinProfile,
  mergeProfiles,
  parseContactInfo,
  parseDashProfile,
  parseProfileView,
  parseSkillsPayload,
} from "../linkedin/parser.js";
import { TtlCache } from "./limits.js";

export class ProfileService {
  private readonly cache: TtlCache<ProfileResponse>;

  constructor(
    private readonly client: LinkedInClient,
    config: Config,
  ) {
    this.cache = new TtlCache(config.cacheTtlSeconds * 1000);
  }

  async lookup(rawUrl: string): Promise<ProfileResponse> {
    const ref = parseProfileUrl(rawUrl);
    const cached = this.cache.get(ref.publicIdentifier.toLowerCase());
    if (cached) {
      return cached;
    }

    const sources: string[] = [];
    let parsed: Partial<ProfileResponse> | null = null;

    const dash = await this.fetchDash(ref.publicIdentifier, sources);
    if (dash) {
      parsed = parseDashProfile(dash, ref.publicIdentifier);
    }

    if (isThinProfile(parsed)) {
      const view = await this.safe(() => this.client.getProfileView(ref.publicIdentifier));
      if (view && view.status !== 404) {
        sources.push("identity.profiles.profileView");
        parsed = mergeProfiles(parsed ?? {}, parseProfileView(view, ref.publicIdentifier));
      }
    }

    if (!parsed?.profile) {
      throw new ProfileNotFoundError(
        `No LinkedIn profile was found for '${ref.publicIdentifier}'.`,
      );
    }

    let profile = parsed.profile;

    if (!parsed.skills?.length) {
      const skills = await this.safe(() => this.client.getSkills(ref.publicIdentifier));
      if (skills && skills.status !== 404) {
        sources.push("identity.profiles.skills");
        parsed = { ...parsed, skills: parseSkillsPayload(skills) };
      }
    }

    const contact = await this.safe(() => this.client.getContactInfo(ref.publicIdentifier));
    if (contact && contact.status !== 404) {
      sources.push("identity.profiles.profileContactInfo");
      const extra = parseContactInfo(contact);
      profile = {
        ...profile,
        contact: {
          email: profile.contact.email ?? extra.email,
          websites: profile.contact.websites.length
            ? profile.contact.websites
            : extra.websites,
          twitter: profile.contact.twitter.length
            ? profile.contact.twitter
            : extra.twitter,
        },
      };
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
      if (!body || body.status === 404) {
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
        error instanceof UpstreamBlockedError ||
        error instanceof UpstreamRateLimitedError
      ) {
        throw error;
      }
      return null;
    }
  }
}
