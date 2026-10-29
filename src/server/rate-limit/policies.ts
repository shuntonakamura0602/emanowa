export const RATE_LIMIT_POLICIES = {
  create: { limit: 10, windowSeconds: 60 },
  edit: { limit: 30, windowSeconds: 10 * 60 },
  report: { limit: 5, windowSeconds: 60 * 60 },
  image: { limit: 30, windowSeconds: 60 },
  otp: { limit: 1, windowSeconds: 60 },
  otp_verify_link: { limit: 5, windowSeconds: 10 * 60 },
  otp_verify: { limit: 5, windowSeconds: 10 * 60 },
  otp_verify_source: { limit: 30, windowSeconds: 10 * 60 },
  otp_verify_target: { limit: 30, windowSeconds: 10 * 60 },
} as const;

export type RateLimitAction = keyof typeof RATE_LIMIT_POLICIES;
