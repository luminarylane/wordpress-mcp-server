/**
 * Token-bucket rate limiter for WordPress REST API.
 *
 * WordPress.org doesn't publish official rate limits, but common hosting
 * configurations (Nginx, Apache, Cloudflare) enforce:
 *   - Reads: ~600 requests per minute
 *   - Writes: ~120 requests per minute (more expensive server-side)
 *
 * Conservative limits to avoid tripping hosting-level WAFs.
 */

import logger from "./lib/logger.js";

interface BucketConfig {
  maxTokens: number;
  refillRate: number; // tokens per millisecond
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(config: BucketConfig) {
    this.maxTokens = config.maxTokens;
    this.refillRate = config.refillRate;
    this.tokens = config.maxTokens;
    this.lastRefill = Date.now();
  }

  tryConsume(cost = 1): boolean {
    this.refill();
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  msUntilAvailable(cost = 1): number {
    this.refill();
    if (this.tokens >= cost) return 0;
    const deficit = cost - this.tokens;
    return Math.ceil(deficit / this.refillRate);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
  }
}

const ONE_MINUTE_MS = 60 * 1000;

const readBucket = new TokenBucket({
  maxTokens: 600,
  refillRate: 600 / ONE_MINUTE_MS,
});

const writeBucket = new TokenBucket({
  maxTokens: 120,
  refillRate: 120 / ONE_MINUTE_MS,
});

export type RateLimitCategory = "read" | "write";

export const WRITE_TOOL_NAMES = new Set([
  "wp_create_post",
  "wp_update_post",
  "wp_delete_post",
  "wp_create_comment",
  "wp_upload_media",
]);

const MAX_WAIT_MS = 60_000;
const MAX_RETRIES = 3;

/**
 * Check if a request is allowed under rate limits.
 * Peek-then-consume: checks all buckets first, only consumes when all pass.
 */
export function checkRateLimit(
  category: RateLimitCategory,
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const bucket = category === "write" ? writeBucket : readBucket;
  const waitMs = bucket.msUntilAvailable();
  if (waitMs > 0) {
    return { allowed: false, retryAfterMs: waitMs };
  }
  bucket.tryConsume();
  return { allowed: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for rate limit to clear (up to 60s), then consume the token.
 */
export async function waitForRateLimit(
  category: RateLimitCategory,
): Promise<{ allowed: true } | { allowed: false; retryAfterMs: number }> {
  const result = checkRateLimit(category);
  if (result.allowed) return result;

  if (result.retryAfterMs > MAX_WAIT_MS) {
    return result;
  }

  logger.error(
    `[rate-limit] Waiting ${Math.ceil(result.retryAfterMs / 1000)}s for ${category} bucket...`,
  );
  await sleep(result.retryAfterMs);
  return checkRateLimit(category);
}

/**
 * Execute an API call with automatic retry on HTTP 429 or 5xx.
 * Exponential backoff: 2s, 4s, 8s.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const isRetryable =
        e instanceof Error &&
        (e.message.includes("429") ||
          e.message.includes("503") ||
          e.message.includes("502") ||
          e.message.toLowerCase().includes("rate limit") ||
          e.message.toLowerCase().includes("too many requests"));

      if (!isRetryable || attempt === MAX_RETRIES) throw e;

      const backoffMs = 2000 * Math.pow(2, attempt);
      logger.error(
        `[rate-limit] WordPress ${e instanceof Error ? e.message.substring(0, 50) : "error"} — ` +
          `backing off ${backoffMs / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`,
      );
      await sleep(backoffMs);
    }
  }
  throw new Error("Unreachable");
}
