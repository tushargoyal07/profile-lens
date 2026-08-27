import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProfileUrl } from "../src/domain/url.js";
import { InvalidProfileUrlError } from "../src/errors.js";
import { buildIndex, collectionElements, field } from "../src/linkedin/restli.js";
import { parseDashProfile, parseProfileView } from "../src/linkedin/parser.js";
import { createApp } from "../src/app.js";
import { loadConfig, testConfig } from "../src/config.js";
import type { ProfileResponse } from "../src/api/schemas.js";
import type { JsonObject } from "../src/lib/json.js";
import {
  allHiddenInputs,
  challengeKind,
  challengeUrlFromPayload,
  hiddenInputValue,
  interpretAuthenticateJson,
  parseLinkedInPayload,
} from "../src/linkedin/auth.js";
import { MemoryCookieJar, parseCookieHeader } from "../src/linkedin/cookies.js";

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

describe("config", () => {
  it("requires a LinkedIn cookie or email and password", () => {
    expect(() => loadConfig({})).toThrow(/LINKEDIN_LI_AT|LINKEDIN_COOKIE|session/);
    expect(() => loadConfig({ LINKEDIN_EMAIL: "a@b.com" })).toThrow(/session/);
    expect(
      loadConfig({ LINKEDIN_EMAIL: "a@b.com", LINKEDIN_PASSWORD: "secret" }).linkedinEmail,
    ).toBe("a@b.com");
  });

  it("accepts a bare li_at cookie without a password", () => {
    const cfg = loadConfig({ LINKEDIN_LI_AT: "AQED-token" });
    expect(cfg.linkedinCookies.li_at).toBe("AQED-token");
    expect(cfg.linkedinEmail).toBeNull();
    expect(cfg.linkedinPassword).toBeNull();
  });

  it("parses a full Cookie header", () => {
    const cfg = loadConfig({
      LINKEDIN_COOKIE: 'Cookie: li_at=token; JSESSIONID="ajax:1"; Path=/',
    });
    expect(cfg.linkedinCookies).toMatchObject({
      li_at: "token",
      JSESSIONID: '"ajax:1"',
    });
    expect(cfg.linkedinCookies.Path).toBeUndefined();
  });
});

describe("LinkedIn login helpers", () => {
  it("reads hidden form fields from either attribute order", () => {
    expect(
      allHiddenInputs(
        `<input type="hidden" name="loginCsrfParam" value="abc123"><input type="text" name="session_key" value="skip">`,
      ),
    ).toEqual({ loginCsrfParam: "abc123" });
    expect(
      hiddenInputValue(
        `<input type="hidden" name="loginCsrfParam" value="abc123">`,
        "loginCsrfParam",
      ),
    ).toBe("abc123");
    expect(
      hiddenInputValue(
        `<input value="xyz" type="hidden" name="loginCsrfParam">`,
        "loginCsrfParam",
      ),
    ).toBe("xyz");
  });

  it("interprets LinkedIn authenticate JSON", () => {
    expect(interpretAuthenticateJson({ login_result: "PASS" }, true)).toEqual({ ok: true });
    expect(interpretAuthenticateJson({ login_result: "PASS" }, false).ok).toBe(false);
    const bad = interpretAuthenticateJson({ login_result: "BAD_USERNAME_OR_PASSWORD" }, false);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.invalidCredentials).toBe(true);
    }
    const challenge = interpretAuthenticateJson({ login_result: "CHALLENGE" }, false);
    expect(challenge.ok).toBe(false);
    if (!challenge.ok) {
      expect(challenge.reason).toMatch(/challenge/i);
    }
  });

  it("stores cookies by name", () => {
    const jar = new MemoryCookieJar();
    jar.setCookie('JSESSIONID="ajax:1"; Path=/; Secure', "https://www.linkedin.com/");
    jar.setCookie("li_at=token; HttpOnly", "https://www.linkedin.com/");
    expect(jar.get("JSESSIONID")).toBe('"ajax:1"');
    expect(jar.getCookieString("https://www.linkedin.com/")).toContain("li_at=token");
  });

  it("parses a browser Cookie header or a bare li_at value", () => {
    expect(parseCookieHeader("AQED-only")).toEqual({ li_at: "AQED-only" });
    expect(parseCookieHeader('li_at=token; JSESSIONID="ajax:9"; Secure')).toEqual({
      li_at: "token",
      JSESSIONID: '"ajax:9"',
    });
  });

  it("parses LinkedIn JSON with an XSS prefix", () => {
    expect(parseLinkedInPayload(`)]}',\n{"login_result":"CHALLENGE"}`)).toEqual({
      login_result: "CHALLENGE",
    });
    expect(parseLinkedInPayload("<html>checkpoint</html>")).toBeNull();
  });

  it("reads a challenge URL and classifies app approval pages", () => {
    expect(
      challengeUrlFromPayload({
        login_result: "CHALLENGE",
        challenge_url: "/checkpoint/challenge/abc",
      }),
    ).toBe("https://www.linkedin.com/checkpoint/challenge/abc");
    expect(
      challengeKind("Check your LinkedIn app", "https://www.linkedin.com/checkpoint/challenge/x"),
    ).toBe("app");
    expect(challengeKind('<body id="error404">', "https://www.linkedin.com/404")).toBe("dead");
  });
});
