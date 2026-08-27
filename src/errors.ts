export class ProfileLensError extends Error {
  readonly status: number;
  readonly errorType: string;
  readonly title: string;
  readonly retryAfter?: number;

  constructor(
    message: string,
    options: {
      status: number;
      errorType: string;
      title: string;
      retryAfter?: number;
    },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.status = options.status;
    this.errorType = options.errorType;
    this.title = options.title;
    this.retryAfter = options.retryAfter;
  }
}

export class InvalidProfileUrlError extends ProfileLensError {
  constructor(detail: string) {
    super(detail, {
      status: 400,
      errorType: "invalid-url",
      title: "Invalid LinkedIn profile URL",
    });
  }
}

export class ProfileNotFoundError extends ProfileLensError {
  constructor(detail = "No LinkedIn profile was found for that URL.") {
    super(detail, {
      status: 404,
      errorType: "not-found",
      title: "Profile not found",
    });
  }
}

export class UnauthorizedError extends ProfileLensError {
  constructor(detail = "Missing or invalid API key.") {
    super(detail, {
      status: 401,
      errorType: "unauthorized",
      title: "Unauthorized",
    });
  }
}

export class RateLimitedError extends ProfileLensError {
  constructor(detail = "Too many requests. Slow down.", retryAfter = 60) {
    super(detail, {
      status: 429,
      errorType: "rate-limited",
      title: "Rate limit exceeded",
      retryAfter,
    });
  }
}

export class SessionExpiredError extends ProfileLensError {
  constructor(
    detail = "The LinkedIn session cookie was rejected. Refresh LINKEDIN_LI_AT.",
  ) {
    super(detail, {
      status: 503,
      errorType: "session-expired",
      title: "LinkedIn session expired",
    });
  }
}

export class UpstreamRateLimitedError extends ProfileLensError {
  constructor(detail = "LinkedIn asked us to slow down.", retryAfter = 60) {
    super(detail, {
      status: 429,
      errorType: "upstream-rate-limited",
      title: "LinkedIn rate limited",
      retryAfter,
    });
  }
}

export class UpstreamBlockedError extends ProfileLensError {
  constructor(
    detail = "LinkedIn blocked the request (anti-bot). Try again later.",
  ) {
    super(detail, {
      status: 503,
      errorType: "upstream-blocked",
      title: "LinkedIn blocked the request",
    });
  }
}

export class UpstreamError extends ProfileLensError {
  constructor(detail: string) {
    super(detail, {
      status: 502,
      errorType: "upstream-error",
      title: "LinkedIn request failed",
    });
  }
}

export class ConfigError extends ProfileLensError {
  constructor(detail: string) {
    super(detail, {
      status: 500,
      errorType: "config",
      title: "Server misconfigured",
    });
  }
}
