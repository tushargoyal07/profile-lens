# Profile Lens

Hosted HTTP API that accepts a LinkedIn **people** profile URL and returns the public profile as structured JSON.

The server holds one LinkedIn session you control and calls internal **Voyager** endpoints over HTTP. Callers only send a profile URL. They do not log in or attach cookies. There is no HTML scraping of profiles, and there is no UI — reviewers can use curl or Postman.

This is a hiring-challenge implementation. It is not affiliated with LinkedIn.

**Repo:** https://github.com/tushargoyal07/profile-lens

- [Setup instructions](#setup-instructions)
- [API documentation](#api-documentation)
- [Approach](#approach)
- [Known limitations](#known-limitations)
- [Deploy over HTTPS](#deploy-over-https)
- [Testing](#testing)
- [Security](#security)
- [Project layout](#project-layout)

## Setup instructions

**Runtime:** Node.js 20+

```bash
git clone https://github.com/tushargoyal07/profile-lens.git
cd profile-lens
npm install
cp .env.example .env
```

The LinkedIn session is an **operator secret** for this process. API callers never send it.

Copy `li_at` and `JSESSIONID` from the **same** LinkedIn session you own:

```
LINKEDIN_LI_AT=AQED…
LINKEDIN_JSESSIONID="ajax:…"
```

Or paste the full Cookie header:

```
LINKEDIN_COOKIE=li_at=AQED…; JSESSIONID="ajax:…"
```

Both values are required and must belong to the same session. `csrf-token` is the `JSESSIONID` value without quotes. When LinkedIn expires the session, replace both values and restart.

```bash
npm run typecheck
npm run dev
```

The process listens on `http://localhost:8080` (or `PORT`). Cookies are loaded at startup; the first Voyager call is the first profile request.

| Script | What it does |
|---|---|
| `npm run dev` | Watch mode (`tsx`) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run `node dist/index.js` |
| `npm run typecheck` | `tsc --noEmit` |

Local Docker (same image as the host):

```bash
docker build -t profile-lens .
docker run --rm -p 8080:8080 --env-file .env profile-lens
```

### Environment

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `LINKEDIN_LI_AT` | with `JSESSIONID` | | Session cookie from an account you own |
| `LINKEDIN_JSESSIONID` | with `li_at` | | CSRF cookie from the **same** session |
| `LINKEDIN_COOKIE` | no | | Full Cookie header (`li_at` + `JSESSIONID`) instead of the two vars above |
| `LINKEDIN_EMAIL` / `LINKEDIN_PASSWORD` | fallback | | Password login if no cookie is set; usually fails on LinkedIn’s app-approval challenge |
| `API_KEY` | no | unset | If set, `/v1/*` requires `X-API-Key` |
| `PORT` | no | `8080` | Listen port |
| `RATE_LIMIT_PER_MINUTE` | no | `10` | Per-IP cap on `/v1` |
| `CACHE_TTL_SECONDS` | no | `600` | In-memory cache per public identifier |
| `REQUEST_TIMEOUT_MS` | no | `20000` | LinkedIn HTTP timeout |
| `LINKEDIN_MIN_INTERVAL_MS` | no | `1000` | Gap between Voyager HTTP calls |
| `PROFILE_COOLDOWN_MS` | no | `8000` | Minimum gap between different profile lookups |

Credentials never belong in git. `.env` and `data/` are gitignored.

## API documentation

Base URL: `http://localhost:8080` locally, or the HTTPS host after deploy.

Errors use [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html) (`Content-Type: application/problem+json`). Rate-limit responses may include `Retry-After`.

If `API_KEY` is set, every `/v1/*` request must send `X-API-Key`. `/` and `/health` stay open.

### `GET /`

Service discovery. Does not call LinkedIn.

```json
{
  "name": "profile-lens",
  "description": "Reverse-engineered LinkedIn profile API. HTTP only, no browser.",
  "health": "/health",
  "lookup": "POST /v1/profiles",
  "docs": "See README.md"
}
```

### `GET /health`

Liveness. Does not call LinkedIn. Use this as the deploy health check.

```bash
curl -sS http://localhost:8080/health
```

```json
{ "status": "ok" }
```

### `POST /v1/profiles`

Preferred lookup. Body is JSON with a people profile URL.

```bash
curl -sS -X POST http://localhost:8080/v1/profiles \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.linkedin.com/in/tushargoyal07/"}'
```

With `API_KEY`:

```bash
curl -sS -X POST https://YOUR_HOST/v1/profiles \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_KEY' \
  -d '{"url":"https://www.linkedin.com/in/tushargoyal07/"}'
```

#### Request

```json
{ "url": "https://www.linkedin.com/in/{public-identifier}/" }
```

Accepted hosts include `linkedin.com`, `www.linkedin.com`, `m.linkedin.com`, and locale hosts such as `in.linkedin.com`. Query strings and trailing `/overlay/...` paths are ignored. Company and school URLs are rejected with `400`.

#### Success `200`

The schema is candidate-designed. Fields the assignment asked for are always present: name, headline, location, about, experience, education, skills, certifications, languages, images (when LinkedIn returns them). Extra fields (`industry`, `volunteer`, `meta`, …) stay for a stable contract.

```json
{
  "input": {
    "url": "https://www.linkedin.com/in/tushargoyal07/",
    "publicIdentifier": "tushargoyal07"
  },
  "profile": {
    "fullName": "Tushar Goyal",
    "firstName": "Tushar",
    "lastName": "Goyal",
    "headline": "…",
    "about": "…",
    "location": "…",
    "industry": null,
    "pronouns": null,
    "profileUrl": "https://www.linkedin.com/in/tushargoyal07/",
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
      "title": "…",
      "companyName": "…",
      "companyUrl": null,
      "location": null,
      "description": "…",
      "employmentType": null,
      "start": { "year": 2024, "month": 1, "day": null },
      "end": null,
      "current": true
    }
  ],
  "education": [],
  "skills": [{ "name": "…", "endorsementCount": null }],
  "certifications": [],
  "languages": [],
  "volunteer": [],
  "meta": {
    "fetchedAt": "2026-08-28T00:00:00.000Z",
    "sources": ["identity.dash.profiles:FullProfileWithEntities-93"],
    "partial": false
  }
}
```

Missing sections are empty arrays or `null`, not omitted. `meta.partial` is `true` when experience, education, or skills came back empty.

Repeat `POST` of the **same** URL is served from `data/profile-cache.json` (and an in-memory TTL) without calling LinkedIn again.

### `GET /v1/profiles`

Same payload as POST, with the URL as a query string.

```bash
curl -sS -G http://localhost:8080/v1/profiles \
  --data-urlencode 'url=https://www.linkedin.com/in/tushargoyal07/'
```

### Errors

| Status | When |
|---|---|
| `400` | URL missing, not LinkedIn, or not a `/in/…` profile |
| `401` | `API_KEY` is set and `X-API-Key` does not match |
| `404` | LinkedIn has no profile for that identifier |
| `429` | This API’s rate limit, or LinkedIn’s |
| `502` | Voyager returned an unexpected failure |
| `503` | Session expired, login failed, or LinkedIn anti-bot (`999`) |

Example `503`:

```json
{
  "type": "https://profile-lens.dev/errors/session-expired",
  "title": "Session Expired",
  "status": 503,
  "detail": "LinkedIn used up this session after a previous lookup.",
  "instance": "/v1/profiles"
}
```

Unknown routes also return problem+json `404`.

## Approach

LinkedIn’s UI is a SPA. The visible profile is not in the HTML; it is loaded from **Voyager**, LinkedIn’s internal REST.li / GraphQL layer. This service reverse-engineers those HTTP calls and maps them onto a stable JSON schema.

**Stack:** Node 20+, Hono, Zod, [`impit`](https://github.com/apify/impit) for TLS impersonation. Chosen so the public API is typed JSON, and the LinkedIn client is still plain HTTP.

### Auth

Voyager authenticates with `li_at` (session) and `csrf-token` equal to `JSESSIONID` without quotes (`ajax:…`). This service loads both from the environment at startup and does not probe LinkedIn until the first profile request. Email/password login is a fallback; 2FA and CAPTCHA checkpoints cannot be completed here.

### Transport

Datacenter Node `fetch` often has a TLS fingerprint LinkedIn rejects. LinkedIn fronts Voyager with PerimeterX (HUMAN). `impit` makes the TCP/TLS handshake look like a typical client **without driving a UI**.

### Endpoints (in order)

1. `GET /voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity={id}&decorationId=…FullProfileWithEntities-{n}`  
   One call is enough when the decoration is still valid. Several decoration IDs are tried because LinkedIn versions them (`-93`, `-85`, …) and stale IDs return `400`.
2. `GET /voyager/api/identity/profiles/{id}/profileView`  
   Older payload. Used when dash data is thin.
3. `GET /voyager/api/identity/profiles/{id}/skills`  
   Skills are often paged out of the main document.

Accept header is `application/vnd.linkedin.normalized+json+2.1` so related entities arrive in `included[]` with `*field` pointers.

Lookups are serialized on one process so two different profiles cannot race the same cookie.

### Parsing

Voyager does not return a résumé object. Collections are REST.li graphs: `*profilePositionGroups` → collection URN → `*elements` → `Position`. Walking the table of contents preserves on-page order. Filtering `included` by `$type` alone reverses experience on some payloads.

The **output** schema is ours (Zod). LinkedIn’s payload is treated as `unknown` and probed. That split is deliberate: their types move, ours must not.

### Abuse controls

A short in-memory cache, a disk cache under `data/` (gitignored), a minimum interval between Voyager calls, and a per-IP rate limit exist to protect the logged-in session, not to look like a production multi-node system.

## Known limitations

- **Unofficial API.** Decoration IDs, query hashes, and field names change without notice. Fallback order is the mitigation; it is not a contract.
- **Session lifetime.** LinkedIn typically allows **one live profile pull per cookie pair**, then invalidates `li_at`. Successful responses are saved under `data/profile-cache.json` so the **same** URL can be served again without calling LinkedIn. A **new** profile needs a fresh `li_at` + `JSESSIONID` from the same session.
- **Visibility.** You only get what this LinkedIn account is allowed to see. Email and other contact fields are usually absent. Some members hide sections.
- **One session, sequential lookups.** Bursting many different IDs on one cookie will fail. Do not reuse the same `li_at` in another client after this process starts using it.
- **Anti-bot.** Hosting on a cheap VPS can still yield HTTP `999` even with TLS impersonation. Residential IPs fail less often.
- **Not a people-search / company scraper.** `/company/` and `/school/` URLs are rejected.
- **No UI.** This is an HTTP API only.
- **Single-process cache and rate limit.** Two instances do not share them. A host restart without `data/` loses the disk cache until the next successful live fetch.
- **ToS.** Automated access to LinkedIn may violate their terms. This repo is for the assignment, not a product.

## Deploy over HTTPS

The assignment asks for a public HTTPS URL. Callers `POST` a profile URL and get JSON. LinkedIn credentials stay in the host’s environment.

`Dockerfile` and `render.yaml` target [Render](https://render.com):

1. Push this repo (already public).
2. New Web Service → this GitHub repo → Docker.
3. In the host’s **environment / secrets** (not git, not the request), set `LINKEDIN_LI_AT` and `LINKEDIN_JSESSIONID`. Set `API_KEY` so strangers cannot burn the remaining live fetch.
4. Health check path: `/health`.
5. After deploy, `POST` the demo profile once to warm the disk cache. Repeat requests for that URL then hit cache.

When LinkedIn expires the session, paste a fresh cookie pair in the dashboard and restart. That is operator maintenance, not part of the public API.

Any Node host that can run Docker (Railway, Fly, a VM) works the same way. Do not bake the session into the image.

After deploy, the reviewer only needs:

```bash
curl -sS -X POST https://YOUR-SERVICE.onrender.com/v1/profiles \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_KEY' \
  -d '{"url":"https://www.linkedin.com/in/tushargoyal07/"}'
```

Replace `YOUR-SERVICE.onrender.com` with the live host once it exists. Until then, local `npm run dev` is the working path.

## Testing

```bash
npm run typecheck
```

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck on every push to `main`. Live lookup is a manual check after cookies are set:

```bash
curl -sS -X POST http://localhost:8080/v1/profiles \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.linkedin.com/in/tushargoyal07/"}'
```

Expect `200` on the first successful pull, then cache hits for that identifier. A second *different* profile on the same cookie often returns `503`.

## Security

- `.env`, `data/`, and `.gh/` are gitignored. Never commit `li_at`, `JSESSIONID`, passwords, or `API_KEY`.
- Callers never send LinkedIn credentials. They only send a profile URL (and `X-API-Key` if configured).
- Set `API_KEY` on any public host. Without it, anyone can spend the one remaining live Voyager fetch.
- Treat a leaked `li_at` as a live session. Rotate it on LinkedIn and update the host env.

## Project layout

```
src/api/          HTTP request/response schemas (Zod)
src/domain/       Profile URL parsing (`/in/{id}` only)
src/linkedin/     Voyager client, REST.li resolver, parsers
src/services/     Orchestration, in-memory + disk cache, rate limit
src/app.ts        Hono routes and problem+json errors
src/index.ts      Process entry (load env, listen)
src/config.ts     Environment
Dockerfile        Multi-stage Node 22 image
render.yaml       Render web service
.github/workflows/ci.yml
```
