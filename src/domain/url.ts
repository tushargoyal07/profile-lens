import { InvalidProfileUrlError } from "../errors.js";

export interface ProfileRef {
  publicIdentifier: string;
  canonicalUrl: string;
  originalUrl: string;
}

const IN_PATH = /^\/(?:[a-z]{2}\/)?in\/(?<identifier>[^/?#]+)\/?/i;
const LOCALE_HOST = /^[a-z]{2}\.linkedin\.com$/i;
const ALLOWED_HOSTS = new Set([
  "linkedin.com",
  "www.linkedin.com",
  "m.linkedin.com",
]);

export function parseProfileUrl(raw: string): ProfileRef {
  if (!raw || !raw.trim()) {
    throw new InvalidProfileUrlError("A LinkedIn profile URL is required.");
  }

  let text = raw.trim();
  if (!text.includes("://")) {
    text = `https://${text}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new InvalidProfileUrlError("Profile URL could not be parsed.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidProfileUrlError("Profile URL must be http or https.");
  }

  const host = parsed.hostname.toLowerCase();
  const linkedinHost =
    ALLOWED_HOSTS.has(host) ||
    LOCALE_HOST.test(host) ||
    host.endsWith(".linkedin.com");
  if (!linkedinHost) {
    throw new InvalidProfileUrlError(
      `URL host '${host}' is not a LinkedIn profile host.`,
    );
  }

  const path = decodeURIComponent(parsed.pathname);
  const match = IN_PATH.exec(path);
  if (!match?.groups?.identifier) {
    if (path.includes("/company/") || path.includes("/school/")) {
      throw new InvalidProfileUrlError(
        "This API reads people profiles (/in/...), not company or school pages.",
      );
    }
    throw new InvalidProfileUrlError(
      "URL must look like https://www.linkedin.com/in/{public-identifier}.",
    );
  }

  let identifier = match.groups.identifier.replace(/\/+$/, "");
  if (["in", "feed", "login", "signup"].includes(identifier.toLowerCase())) {
    throw new InvalidProfileUrlError("Could not find a public identifier in the URL.");
  }
  if (!/^[A-Za-z0-9%_\-.'’]+$/.test(identifier)) {
    throw new InvalidProfileUrlError("Public identifier contains unexpected characters.");
  }

  identifier = decodeURIComponent(identifier);
  return {
    publicIdentifier: identifier,
    canonicalUrl: `https://www.linkedin.com/in/${identifier}/`,
    originalUrl: raw.trim(),
  };
}
