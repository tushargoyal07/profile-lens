# Profile Lens

Hosted HTTP API that accepts a LinkedIn **people** profile URL and returns the public profile as structured JSON.

It talks to LinkedIn the same way the website does: the **server** holds one session from an account **you** control, then calls internal **Voyager** endpoints. Callers of the hosted URL only send a profile URL. They do not log in, paste cookies, or open a browser. There is **no Playwright** and no HTML scraping of profiles.

This is a hiring-challenge implementation. It is not affiliated with LinkedIn. Use a session you own, keep request volume low, and treat LinkedIn’s ToS as a hard constraint for anything beyond this exercise.

## Setup

**Runtime:** Node.js 20+

```bash
git clone https://github.com/tushargoyal07/profile-lens.git
cd profile-lens
npm install
cp .env.example .env
```

This cookie is **your** operator secret for the process, not something API users attach to requests. Password login still exists as a fallback, but LinkedIn usually issues an app-approval challenge, so a cookie is the reliable path for now.

1. Sign in to LinkedIn in Chrome (or any desktop browser).
2. Open DevTools → **Application** → **Cookies** → `https://www.linkedin.com`.
3. Copy the `li_at` value into `.env`:

```
LINKEDIN_LI_AT=AQED…
```

Or paste the whole **Cookie** request header from any LinkedIn network request:

```
LINKEDIN_COOKIE=li_at=AQED…; JSESSIONID="ajax:…"
```

The process loads that cookie at startup and uses it for Voyager calls. When LinkedIn expires the session, copy a fresh `li_at` and restart.

```bash
npm test
npm run dev
```

The process listens on `http://localhost:8080` (or `PORT`).

### Environment

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `LINKEDIN_LI_AT` | one of cookie / password | | `li_at` cookie from a browser session you own |
| `LINKEDIN_COOKIE` | no | | Full Cookie header (`li_at` + `JSESSIONID` + others) |
| `LINKEDIN_JSESSIONID` | no | | CSRF cookie; fetched from LinkedIn if omitted |
| `LINKEDIN_EMAIL` | fallback | | LinkedIn login email (optional if a cookie is set) |
| `LINKEDIN_PASSWORD` | fallback | | LinkedIn login password (optional if a cookie is set) |
| `API_KEY` | no | unset | If set, `/v1/*` requires `X-API-Key` |
| `PORT` | no | `8080` | Listen port |
| `RATE_LIMIT_PER_MINUTE` | no | `10` | Per-IP cap on `/v1` |
| `CACHE_TTL_SECONDS` | no | `600` | In-memory cache per public identifier |
| `REQUEST_TIMEOUT_MS` | no | `20000` | LinkedIn HTTP timeout |
| `LINKEDIN_MIN_INTERVAL_MS` | no | `250` | Gap between Voyager calls |

Credentials never belong in git. `.env` is gitignored.

## API documentation

Errors use [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html) (`Content-Type: application/problem+json`).

### `GET /health`

Liveness. Does not call LinkedIn.

### `POST /v1/profiles`

```bash
curl -sS -X POST http://localhost:8080/v1/profiles \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.linkedin.com/in/williamhgates/"}'
```

`GET /v1/profiles?url=` is supported for the same payload.

If `API_KEY` is set:

```bash
curl -sS -X POST https://YOUR_HOST/v1/profiles \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_KEY' \
  -d '{"url":"https://www.linkedin.com/in/williamhgates/"}'
```

#### Request

```json
{ "url": "https://www.linkedin.com/in/{public-identifier}/" }
```

Accepted hosts include `linkedin.com`, `www.linkedin.com`, `m.linkedin.com`, and locale hosts such as `in.linkedin.com`. Query strings and trailing `/overlay/...` paths are ignored. Company and school URLs are rejected with `400`.

#### Success `200`

```json
{
  "input": {
    "url": "https://www.linkedin.com/in/williamhgates/",
    "publicIdentifier": "williamhgates"
  },
  "profile": {
    "fullName": "Bill Gates",
    "firstName": "Bill",
    "lastName": "Gates",
    "headline": "…",
    "about": "…",
    "location": "Seattle, Washington, United States",
    "industry": null,
    "pronouns": null,
    "profileUrl": "https://www.linkedin.com/in/williamhgates/",
    "premium": null,
    "influencer": null,
    "images": {
      "profile": "https://media.licdn.com/…",
      "background": "https://media.licdn.com/…"
    },
    "contact": {
      "email": null,
      "websites": [],
      "twitter": []
    }
  },
  "experience": [
    {
      "title": "Co-chair",
      "companyName": "Bill & Melinda Gates Foundation",
      "companyUrl": null,
      "location": null,
      "description": "…",
      "employmentType": null,
      "start": { "year": 2000, "month": 1, "day": null },
      "end": null,
      "current": true
    }
  ],
  "education": [],
  "skills": [{ "name": "Philanthropy", "endorsementCount": null }],
  "certifications": [],
  "languages": [],
  "volunteer": [],
  "meta": {
    "fetchedAt": "2026-08-27T15:00:00.000Z",
    "sources": ["identity.dash.profiles:FullProfileWithEntities-93"],
    "partial": false
  }
}
```

Missing sections are empty arrays or `null`, not omitted, so the schema stays stable.

#### Errors

| Status | When |
|---|---|
| `400` | URL missing, not LinkedIn, or not a `/in/…` profile |
| `401` | `API_KEY` is set and `X-API-Key` does not match |
| `404` | LinkedIn has no profile for that identifier |
| `429` | This API’s rate limit, or LinkedIn’s |
| `502` | Voyager returned an unexpected failure |
| `503` | Cookie rejected/expired, login failed, or LinkedIn anti-bot (`999`) |

## Approach

LinkedIn’s UI is a SPA. The visible profile is not in the HTML; it is loaded from **Voyager**, LinkedIn’s internal REST.li / GraphQL layer.

### Auth

The website authenticates with `li_at` (session) and sends `csrf-token` equal to `JSESSIONID` without quotes (`ajax:…`). This service loads `LINKEDIN_LI_AT` / `LINKEDIN_COOKIE` from the environment, picks up `JSESSIONID` if needed, and then calls Voyager the same way. If LinkedIn expires the cookie, copy a fresh one from the browser. Email/password login is a fallback; 2FA and CAPTCHA checkpoints cannot be completed here.

### Transport

Datacenter Node `fetch` often gets a different TLS fingerprint than Chrome. LinkedIn fronts Voyager with PerimeterX (HUMAN). This client uses [`impit`](https://github.com/apify/impit) with `browser: "chrome"` so the TCP/TLS handshake looks like Chrome **without opening a browser**.

### Endpoints (in order)

1. `GET /voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity={id}&decorationId=…FullProfileWithEntities-{n}`  
   One call is enough when the decoration is still valid. Several decoration IDs are tried because LinkedIn versions them (`-93`, `-85`, …) and stale IDs return `400`.
2. `GET /voyager/api/identity/profiles/{id}/profileView`  
   Older payload. Used when dash data is thin.
3. `GET /voyager/api/identity/profiles/{id}/skills`  
   Skills are often paged out of the main document.
4. `GET /voyager/api/identity/profiles/{id}/profileContactInfo`  
   Email / websites / Twitter, and only when LinkedIn would show them to this session (usually 1st-degree).

Accept header is `application/vnd.linkedin.normalized+json+2.1` so related entities arrive in `included[]` with `*field` pointers.

### Parsing

Voyager does not return a résumé object. Collections are REST.li graphs: `*profilePositionGroups` → collection URN → `*elements` → `Position`. Walking the table of contents preserves on-page order. Filtering `included` by `$type` alone reverses experience on some payloads.

The **output** schema is ours (Zod). LinkedIn’s payload is treated as `unknown` and probed. That split is deliberate: their types move, ours must not.

### Abuse controls

A short in-memory cache, a minimum interval between Voyager calls, and a per-IP rate limit exist to protect the logged-in session, not to look like a production multi-node system.

## Known limitations

- **Unofficial API.** Decoration IDs, query hashes, and field names change without notice. Fallback order is the mitigation; it is not a contract.
- **Session lifetime.** LinkedIn sessions expire. Paste a fresh `li_at` when you get `503` `session-expired` or `login-failed`. Password re-login is skipped when a cookie is configured, because it usually lands on an app-approval challenge.
- **Visibility.** You only get what this LinkedIn account is allowed to see. Email is usually absent for out-of-network profiles. Some members hide sections.
- **Anti-bot.** Hosting on a cheap VPS can still yield HTTP `999` even with Chrome TLS impersonation. Residential IPs fail less often.
- **Not a people-search / company scraper.** `/company/` and `/school/` URLs are rejected.
- **Single-process cache and rate limit.** Two instances do not share them.
- **ToS.** Automated access to LinkedIn may violate their terms. This repo is for the assignment, not a product.

## Deploy over HTTPS

The assignment asks for a public HTTPS URL. People who hit that URL should only `POST` a profile URL and get JSON. LinkedIn auth stays on the server.

The included `Dockerfile` and `render.yaml` target [Render](https://render.com):

1. Push this repo (already public).
2. New Web Service → this GitHub repo → Docker.
3. In the host’s **environment / secrets** (not git, not the request), set `LINKEDIN_LI_AT` from your own browser session. Optionally set `API_KEY`.
4. Health check path: `/health`.

That env var **is** how the cookie is kept after you deploy. Render persists it across restarts. API callers never see it and never open LinkedIn. When LinkedIn expires `li_at` (days to weeks), you paste a fresh value in the dashboard and restart — that is operator maintenance, not part of the public API.

Any Node host that can run Docker (Railway, Fly, a VM) works the same way. Do not bake the session cookie into the image.

After deploy, the reviewer only needs:

```bash
curl -sS -X POST https://YOUR-SERVICE.onrender.com/v1/profiles \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.linkedin.com/in/YOUR_PROFILE/"}'
```

## Project layout

```
src/api/          HTTP schemas
src/domain/       Profile URL parsing
src/linkedin/     Voyager client, REST.li resolver, parsers
src/services/     Orchestration, cache, rate limit
src/app.ts        Hono routes
tests/            Fixtures + unit/API tests (no live LinkedIn)
```

`npm test` never needs LinkedIn credentials. CI runs the same suite on every push.
