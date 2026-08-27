import { mkdir, writeFile } from "node:fs/promises";
import type { Impit } from "impit";
import { LoginError, UpstreamBlockedError } from "../errors.js";
import { isObject } from "../lib/json.js";
import { ingestSetCookieHeaders, type MemoryCookieJar } from "./cookies.js";

const LOGIN_PAGE = "https://www.linkedin.com/login";
const AUTHENTICATE = "https://www.linkedin.com/uas/authenticate";
const LOGIN_SUBMIT = "https://www.linkedin.com/checkpoint/lg/login-submit";
const FEED = "https://www.linkedin.com/feed/";

const APP_APPROVAL_POLLS = 45;
const APP_APPROVAL_INTERVAL_MS = 4_000;

const BROWSER_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
} as const;

export interface LinkedInSession {
  liAt: string;
  jsessionId: string;
}

export type ChallengeKind = "app" | "pin" | "captcha" | "dead" | "login" | "unknown";

export function hiddenInputValue(html: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = html.match(
    new RegExp(`name=["']${escaped}["'][^>]*value=["']([^"']+)["']`, "i"),
  );
  if (named?.[1]) {
    return named[1];
  }
  const valued = html.match(
    new RegExp(`value=["']([^"']+)["'][^>]*name=["']${escaped}["']`, "i"),
  );
  return valued?.[1];
}

export function allHiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const tags = html.match(/<input\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const type = tag.match(/\btype=["']([^"']*)["']/i)?.[1]?.toLowerCase() ?? "hidden";
    if (type !== "hidden") {
      continue;
    }
    const name = tag.match(/\bname=["']([^"']+)["']/i)?.[1];
    if (!name) {
      continue;
    }
    const raw = tag.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? "";
    out[name] = raw
      .replaceAll("&amp;", "&")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
  }
  return out;
}

export function parseLinkedInPayload(text: string): unknown {
  const stripped = text
    .replace(/^\uFEFF/, "")
    .replace(/^\s*\)\]\}',?\s*/, "")
    .trim();
  if (!stripped) {
    return null;
  }
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    return null;
  }
}

export function challengeUrlFromPayload(payload: unknown): string | undefined {
  if (!isObject(payload)) {
    return undefined;
  }
  const raw = payload.challenge_url ?? payload.challengeUrl;
  return typeof raw === "string" ? absoluteLinkedInUrl(raw) : undefined;
}

export function challengeKind(html: string, url: string): ChallengeKind {
  if (/id=["']error404["']/i.test(html) || /page not found/i.test(html)) {
    return "dead";
  }
  if (/recaptcha|hcaptcha|are you a robot/i.test(html)) {
    return "captcha";
  }
  const hay = `${url}\n${html}`.toLowerCase();
  const appHints =
    hay.includes("linkedin app") ||
    hay.includes("yes, it's me") ||
    hay.includes("yes it’s me") ||
    hay.includes("check your linkedin") ||
    hay.includes("open the linkedin app") ||
    hay.includes("open your linkedin app") ||
    /challengesv2\/inapp/i.test(url) ||
    (hay.includes("approve") && hay.includes("notification"));
  if (appHints) {
    return "app";
  }
  if (/name=["'](?:pin|0-pin)["']/i.test(html)) {
    return "pin";
  }
  if (/checkpoint|challenge/i.test(url)) {
    return "app";
  }
  if (/session_password/i.test(html) && /logincsrfparam/i.test(html)) {
    return "login";
  }
  return "unknown";
}

export function interpretAuthenticateJson(
  payload: unknown,
  hasLiAt: boolean,
): { ok: true } | { ok: false; invalidCredentials: boolean; reason: string } {
  if (hasLiAt) {
    return { ok: true };
  }
  if (!isObject(payload)) {
    return {
      ok: false,
      invalidCredentials: false,
      reason: "LinkedIn login returned a non-JSON response (possible challenge page).",
    };
  }
  const result = String(payload.login_result ?? payload.status ?? "").toUpperCase();
  if (result === "PASS") {
    return {
      ok: false,
      invalidCredentials: false,
      reason: "LinkedIn accepted the login but did not issue an li_at cookie.",
    };
  }
  if (result === "CHALLENGE") {
    return {
      ok: false,
      invalidCredentials: false,
      reason:
        "LinkedIn issued a security challenge (2FA or CAPTCHA). Complete it in a browser, then try again.",
    };
  }
  if (
    result === "BAD_USERNAME_OR_PASSWORD" ||
    result === "BAD_EMAIL" ||
    result === "BAD_PASSWORD" ||
    result === "BAD_USERNAME"
  ) {
    return {
      ok: false,
      invalidCredentials: true,
      reason: "LinkedIn rejected the email or password.",
    };
  }
  if (result) {
    return {
      ok: false,
      invalidCredentials: false,
      reason: `LinkedIn login failed (${result}).`,
    };
  }
  return {
    ok: false,
    invalidCredentials: false,
    reason: "LinkedIn login failed.",
  };
}

function absoluteLinkedInUrl(href: string): string | undefined {
  try {
    return new URL(href, "https://www.linkedin.com/").toString();
  } catch {
    return undefined;
  }
}

function sessionFromJar(jar: MemoryCookieJar): LinkedInSession | null {
  const liAt = jar.get("li_at")?.replace(/^"+|"+$/g, "");
  const jsessionId = jar.get("JSESSIONID");
  if (!liAt || !jsessionId) {
    return null;
  }
  return { liAt, jsessionId };
}

async function readBody(response: {
  headers: Headers;
  url: string;
  text: () => Promise<string>;
}): Promise<string> {
  return response.text();
}

async function saveDebug(name: string, text: string): Promise<void> {
  try {
    await mkdir("data", { recursive: true });
    await writeFile(`data/${name}`, text);
  } catch {
    // debug dumps are best-effort
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loginWithPassword(
  impit: Impit,
  jar: MemoryCookieJar,
  email: string,
  password: string,
): Promise<LinkedInSession> {
  jar.clear();

  const loginPage = await impit.fetch(LOGIN_PAGE, {
    method: "GET",
    headers: BROWSER_HEADERS,
  });
  ingestSetCookieHeaders(loginPage.headers, loginPage.url, jar);
  if (loginPage.status === 999) {
    throw new UpstreamBlockedError();
  }
  const loginHtml = await readBody(loginPage);
  await saveDebug("last-login.html", loginHtml);
  console.error(
    `LinkedIn login page status=${loginPage.status} url=${loginPage.url} csrf=${Boolean(hiddenInputValue(loginHtml, "loginCsrfParam"))}`,
  );

  const existing = sessionFromJar(jar);
  if (existing) {
    return existing;
  }

  const viaApi = await tryAuthenticate(impit, jar, email, password);
  if (viaApi.session) {
    return viaApi.session;
  }
  if (viaApi.invalidCredentials) {
    throw new LoginError(viaApi.reason);
  }
  if (viaApi.pollUrl) {
    const waited = await waitForAppApproval(impit, jar, viaApi.pollUrl);
    if (waited) {
      return waited;
    }
    throw new LoginError(
      "Timed out waiting for LinkedIn app approval. Approve the sign-in request in the LinkedIn app while this process is still running.",
    );
  }

  const viaForm = await tryWebForm(impit, jar, email, password, loginHtml);
  if (viaForm.session) {
    return viaForm.session;
  }
  if (viaForm.pollUrl) {
    const waited = await waitForAppApproval(impit, jar, viaForm.pollUrl);
    if (waited) {
      return waited;
    }
    throw new LoginError(
      "Timed out waiting for LinkedIn app approval. Approve the sign-in request in the LinkedIn app while this process is still running.",
    );
  }

  throw new LoginError(viaApi.reason);
}

async function tryAuthenticate(
  impit: Impit,
  jar: MemoryCookieJar,
  email: string,
  password: string,
): Promise<{
  session: LinkedInSession | null;
  invalidCredentials: boolean;
  reason: string;
  pollUrl: string | null;
}> {
  const jsession = jar.get("JSESSIONID");
  if (!jsession) {
    return {
      session: null,
      invalidCredentials: false,
      reason: "LinkedIn did not issue a JSESSIONID cookie on the login page.",
      pollUrl: null,
    };
  }

  const csrf = jsession.replace(/^"+|"+$/g, "");
  const response = await impit.fetch(AUTHENTICATE, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/x-www-form-urlencoded",
      "csrf-token": csrf,
      origin: "https://www.linkedin.com",
      referer: LOGIN_PAGE,
      "x-requested-with": "XMLHttpRequest",
    },
    body: new URLSearchParams({
      session_key: email,
      session_password: password,
      JSESSIONID: csrf,
    }),
  });
  ingestSetCookieHeaders(response.headers, response.url, jar);
  const text = await readBody(response);
  const locationHeader = response.headers.get("location");
  const location = locationHeader ? absoluteLinkedInUrl(locationHeader) : undefined;
  const payload = parseLinkedInPayload(text);
  const kind = challengeKind(text, location ?? response.url);
  const session = sessionFromJar(jar);
  const interpreted = interpretAuthenticateJson(payload, Boolean(session));

  await saveDebug(
    "last-auth-response.txt",
    [
      `status=${response.status}`,
      `url=${response.url}`,
      `location=${location ?? ""}`,
      `content-type=${response.headers.get("content-type") ?? ""}`,
      `kind=${kind}`,
      `hasLiAt=${Boolean(session)}`,
      "",
      text.slice(0, 4000),
    ].join("\n"),
  );

  if (interpreted.ok && session) {
    return { session, invalidCredentials: false, reason: "", pollUrl: null };
  }
  if (interpreted.invalidCredentials) {
    return {
      session: null,
      invalidCredentials: true,
      reason: interpreted.reason,
      pollUrl: null,
    };
  }

  const jsonChallenge =
    isObject(payload) &&
    String(payload.login_result ?? payload.status ?? "").toUpperCase() === "CHALLENGE";
  const pollUrl =
    challengeUrlFromPayload(payload) ??
    location ??
    (kind === "app" || jsonChallenge ? response.url : null);

  console.error(
    `LinkedIn authenticate status=${response.status} kind=${kind} json=${Boolean(payload)} poll=${pollUrl ?? "no"}`,
  );

  if (kind === "captcha") {
    return {
      session: null,
      invalidCredentials: false,
      reason: "LinkedIn issued a CAPTCHA. Complete it in a browser, then try again.",
      pollUrl: null,
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      session: null,
      invalidCredentials: false,
      reason: interpreted.reason,
      pollUrl: null,
    };
  }
  if (kind === "login" || kind === "dead") {
    return {
      session: null,
      invalidCredentials: false,
      reason: interpreted.reason,
      pollUrl: null,
    };
  }
  if (jsonChallenge || kind === "app" || kind === "pin" || pollUrl) {
    return {
      session: null,
      invalidCredentials: false,
      reason: interpreted.reason,
      pollUrl: pollUrl ?? response.url,
    };
  }

  return {
    session: null,
    invalidCredentials: false,
    reason: interpreted.reason,
    pollUrl: null,
  };
}

async function waitForAppApproval(
  impit: Impit,
  jar: MemoryCookieJar,
  pollUrl: string,
): Promise<LinkedInSession | null> {
  const urls = [...new Set([pollUrl, FEED])];
  console.error(
    "LinkedIn sent a sign-in request to your phone. Open the LinkedIn app and approve it now. Waiting up to 3 minutes...",
  );

  for (let attempt = 1; attempt <= APP_APPROVAL_POLLS; attempt += 1) {
    const existing = sessionFromJar(jar);
    if (existing) {
      console.error("LinkedIn app approval received.");
      return existing;
    }

    for (const url of urls) {
      try {
        const response = await impit.fetch(url, {
          method: "GET",
          headers: BROWSER_HEADERS,
        });
        ingestSetCookieHeaders(response.headers, response.url, jar);
        await readBody(response);
        const session = sessionFromJar(jar);
        if (session) {
          console.error("LinkedIn app approval received.");
          return session;
        }
      } catch {
        // Keep polling; individual requests can fail while the challenge is open.
      }
    }

    if (attempt === 1 || attempt % 5 === 0) {
      console.error(`Still waiting for LinkedIn app approval (${attempt}/${APP_APPROVAL_POLLS})...`);
    }
    await sleep(APP_APPROVAL_INTERVAL_MS);
  }

  return null;
}

async function tryWebForm(
  impit: Impit,
  jar: MemoryCookieJar,
  email: string,
  password: string,
  loginHtml: string,
): Promise<{ session: LinkedInSession | null; pollUrl: string | null }> {
  const hidden = allHiddenInputs(loginHtml);
  const loginCsrfParam = hidden.loginCsrfParam ?? hiddenInputValue(loginHtml, "loginCsrfParam");
  const csrfToken =
    hidden.csrfToken ??
    hiddenInputValue(loginHtml, "csrfToken") ??
    jar.get("JSESSIONID")?.replace(/^"+|"+$/g, "");
  if (!loginCsrfParam || !csrfToken) {
    console.error("LinkedIn login page is missing CSRF fields; cannot submit the web form.");
    return { session: null, pollUrl: null };
  }

  const body = new URLSearchParams(hidden);
  body.set("csrfToken", csrfToken);
  body.set("loginCsrfParam", loginCsrfParam);
  body.set("session_key", email);
  body.set("session_password", password);

  const response = await impit.fetch(LOGIN_SUBMIT, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "content-type": "application/x-www-form-urlencoded",
      referer: LOGIN_PAGE,
    },
    body,
  });
  ingestSetCookieHeaders(response.headers, response.url, jar);

  const session = sessionFromJar(jar);
  if (session) {
    return { session, pollUrl: null };
  }

  const html = await readBody(response);
  const finalUrl = response.url;
  const kind = challengeKind(html, finalUrl);
  await saveDebug("last-challenge.html", html);
  console.error(`LinkedIn login-submit status=${response.status} kind=${kind} url=${finalUrl}`);

  if (kind === "app" || kind === "pin" || /checkpoint|challenge|add-phone/i.test(finalUrl)) {
    return { session: null, pollUrl: finalUrl };
  }
  return { session: sessionFromJar(jar), pollUrl: null };
}
