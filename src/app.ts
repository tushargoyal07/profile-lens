import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Config } from "./config.js";
import {
  InvalidProfileUrlError,
  ProfileLensError,
  RateLimitedError,
  UnauthorizedError,
} from "./errors.js";
import { profileRequestSchema } from "./api/schemas.js";
import { parseProfileUrl } from "./domain/url.js";
import type { ProfileService } from "./services/profile-service.js";
import { SlidingWindowLimiter } from "./services/limits.js";

export interface AppDeps {
  config: Config;
  service: ProfileService;
}

function problem(c: { req: { path: string }; body: Function }, error: ProfileLensError) {
  const body: Record<string, unknown> = {
    type: `https://profile-lens.dev/errors/${error.errorType}`,
    title: error.title,
    status: error.status,
    detail: error.message,
    instance: c.req.path,
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/problem+json",
  };
  if (error.retryAfter !== undefined) {
    headers["Retry-After"] = String(error.retryAfter);
    body.retryAfter = error.retryAfter;
  }
  return c.body(JSON.stringify(body), error.status, headers);
}

const validate = zValidator("json", profileRequestSchema, (result) => {
  if (!result.success) {
    const detail = result.error.issues.map((issue) => issue.message).join("; ");
    throw new InvalidProfileUrlError(detail || "Invalid request");
  }
});

const validateQuery = zValidator("query", profileRequestSchema, (result) => {
  if (!result.success) {
    const detail = result.error.issues.map((issue) => issue.message).join("; ");
    throw new InvalidProfileUrlError(detail || "A LinkedIn profile URL is required.");
  }
});

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const limiter = new SlidingWindowLimiter(deps.config.rateLimitPerMinute, 60_000);

  app.onError((err, c) => {
    if (err instanceof ProfileLensError) {
      return problem(c, err);
    }
    console.error(err);
    return problem(
      c,
      new ProfileLensError("Something went wrong", {
        status: 500,
        errorType: "internal",
        title: "Internal Server Error",
      }),
    );
  });

  app.get("/", (c) => {
    return c.json({
      name: "profile-lens",
      description: "Reverse-engineered LinkedIn profile API. HTTP only, no browser.",
      health: "/health",
      lookup: "POST /v1/profiles",
      docs: "See README.md",
    });
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.use("/v1/*", async (c, next) => {
    if (deps.config.apiKey) {
      const key = c.req.header("x-api-key");
      if (key !== deps.config.apiKey) {
        throw new UnauthorizedError();
      }
    }
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip");
    if (!limiter.allow(ip || "anonymous")) {
      throw new RateLimitedError();
    }
    await next();
  });

  app.post("/v1/profiles", validate, async (c) => {
    const { url } = c.req.valid("json");
    parseProfileUrl(url);
    return c.json(await deps.service.lookup(url));
  });

  app.get("/v1/profiles", validateQuery, async (c) => {
    const { url } = c.req.valid("query");
    parseProfileUrl(url);
    return c.json(await deps.service.lookup(url));
  });

  app.notFound((c) =>
    problem(
      c,
      new ProfileLensError(`No route for ${c.req.method} ${c.req.path}`, {
        status: 404,
        errorType: "not-found",
        title: "Not Found",
      }),
    ),
  );

  return app;
}
