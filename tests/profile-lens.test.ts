import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProfileUrl } from "../src/domain/url.js";
import { InvalidProfileUrlError } from "../src/errors.js";
import { buildIndex, collectionElements, field } from "../src/linkedin/restli.js";
import { parseDashProfile, parseProfileView } from "../src/linkedin/parser.js";
import { createApp } from "../src/app.js";
import { testConfig } from "../src/config.js";
import type { ProfileResponse } from "../src/api/schemas.js";
import type { JsonObject } from "../src/lib/json.js";

const dash = JSON.parse(
  readFileSync(new URL("./fixtures/dash-profile.json", import.meta.url), "utf8"),
) as JsonObject;
const profileView = JSON.parse(
  readFileSync(new URL("./fixtures/profile-view.json", import.meta.url), "utf8"),
) as JsonObject;

describe("parseProfileUrl", () => {
  it("extracts the public identifier from common URL shapes", () => {
    const urls = [
      "https://www.linkedin.com/in/ada-lovelace",
      "https://www.linkedin.com/in/ada-lovelace/",
      "linkedin.com/in/ada-lovelace?utm_source=share",
      "https://in.linkedin.com/in/ada-lovelace/",
      "https://www.linkedin.com/in/ada-lovelace/overlay/about-this-profile/",
    ];
    for (const url of urls) {
      expect(parseProfileUrl(url).publicIdentifier).toBe("ada-lovelace");
    }
  });

  it("rejects company pages and non-LinkedIn hosts", () => {
    expect(() => parseProfileUrl("https://www.linkedin.com/company/tross")).toThrow(
      InvalidProfileUrlError,
    );
    expect(() => parseProfileUrl("https://example.com/in/ada")).toThrow(InvalidProfileUrlError);
    expect(() => parseProfileUrl("")).toThrow(InvalidProfileUrlError);
  });
});

describe("REST.li resolver", () => {
  it("walks *elements pointers in order", () => {
    const index = buildIndex(dash);
    const profile = index.get("urn:li:fsd_profile:ACoAAA");
    const groups = field(profile, index, "profilePositionGroups");
    const positions = collectionElements(groups, index);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ title: "Analyst" });
  });
});

describe("profile parsers", () => {
  it("maps a dash FullProfile payload into the public schema", () => {
    const parsed = parseDashProfile(dash, "ada-lovelace");
    expect(parsed?.profile?.fullName).toBe("Ada Lovelace");
    expect(parsed?.profile?.headline).toBe("Mathematician");
    expect(parsed?.profile?.about).toContain("algorithm");
    expect(parsed?.profile?.location).toBe("London, England");
    expect(parsed?.profile?.images.profile).toBe("https://media.licdn.com/img/large.jpg");
    expect(parsed?.experience[0]?.title).toBe("Analyst");
    expect(parsed?.education[0]?.schoolName).toBe("University of London");
    expect(parsed?.skills[0]).toEqual({ name: "Algorithms", endorsementCount: 42 });
    expect(parsed?.certifications[0]?.name).toBe("Engine Programming");
    expect(parsed?.languages[0]).toEqual({
      name: "English",
      proficiency: "Native or bilingual",
    });
  });

  it("maps a legacy profileView payload", () => {
    const parsed = parseProfileView(profileView, "ada-lovelace");
    expect(parsed?.profile?.fullName).toBe("Ada Lovelace");
    expect(parsed?.experience[0]?.companyName).toBe("Charles Babbage");
    expect(parsed?.skills[0]?.name).toBe("Mathematics");
  });
});

describe("HTTP API", () => {
  it("looks up a profile and rejects bad URLs with problem+json", async () => {
    const fake: ProfileResponse = {
      input: { url: "https://www.linkedin.com/in/ada-lovelace/", publicIdentifier: "ada-lovelace" },
      profile: {
        fullName: "Ada Lovelace",
        firstName: "Ada",
        lastName: "Lovelace",
        headline: "Mathematician",
        about: null,
        location: "London",
        industry: null,
        pronouns: null,
        profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
        premium: null,
        influencer: null,
        images: { profile: null, background: null },
        contact: { email: null, websites: [], twitter: [] },
      },
      experience: [],
      education: [],
      skills: [],
      certifications: [],
      languages: [],
      volunteer: [],
      meta: { fetchedAt: "2026-08-27T00:00:00.000Z", sources: ["test"], partial: true },
    };

    const app = createApp({
      config: testConfig(),
      service: { lookup: async () => fake } as never,
    });

    const ok = await app.request("http://localhost/v1/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://www.linkedin.com/in/ada-lovelace/" }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.profile.fullName).toBe("Ada Lovelace");

    const bad = await app.request("http://localhost/v1/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/nope" }),
    });
    expect(bad.status).toBe(400);
    expect(bad.headers.get("content-type")).toContain("application/problem+json");

    const health = await app.request("http://localhost/health");
    expect(health.status).toBe(200);
  });

  it("requires an API key when configured", async () => {
    const app = createApp({
      config: testConfig({ apiKey: "secret" }),
      service: { lookup: async () => ({}) } as never,
    });
    const res = await app.request("http://localhost/v1/profiles?url=https://www.linkedin.com/in/ada");
    expect(res.status).toBe(401);
  });
});
