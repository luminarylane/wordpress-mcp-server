import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkRateLimit,
  waitForRateLimit,
  withRetry,
  WRITE_TOOL_NAMES,
} from "./rate-limiter.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows read requests under the limit", () => {
    expect(checkRateLimit("read").allowed).toBe(true);
  });

  it("allows write requests under the limit", () => {
    expect(checkRateLimit("write").allowed).toBe(true);
  });

  it("blocks further write requests once the bucket is exhausted", () => {
    let allowedCount = 0;
    let blocked: ReturnType<typeof checkRateLimit> | undefined;
    for (let i = 0; i < 200; i++) {
      const result = checkRateLimit("write");
      if (!result.allowed) {
        blocked = result;
        break;
      }
      allowedCount++;
    }
    expect(blocked).toBeDefined();
    expect(blocked!.allowed).toBe(false);
    if (!blocked!.allowed) expect(blocked!.retryAfterMs).toBeGreaterThan(0);
    expect(allowedCount).toBeLessThanOrEqual(120);
  });

  it("refills the write bucket over time", () => {
    while (checkRateLimit("write").allowed) {
      /* drain */
    }
    expect(checkRateLimit("write").allowed).toBe(false);

    vi.advanceTimersByTime(65_000);

    expect(checkRateLimit("write").allowed).toBe(true);
  });

  it("keeps read and write buckets independent", () => {
    while (checkRateLimit("write").allowed) {
      /* drain write bucket only */
    }
    expect(checkRateLimit("read").allowed).toBe(true);
  });
});

describe("WRITE_TOOL_NAMES", () => {
  it("contains exactly 5 write tools", () => {
    expect(WRITE_TOOL_NAMES.size).toBe(5);
  });

  it("contains all expected write tools", () => {
    expect(WRITE_TOOL_NAMES.has("wp_create_post")).toBe(true);
    expect(WRITE_TOOL_NAMES.has("wp_update_post")).toBe(true);
    expect(WRITE_TOOL_NAMES.has("wp_delete_post")).toBe(true);
    expect(WRITE_TOOL_NAMES.has("wp_create_comment")).toBe(true);
    expect(WRITE_TOOL_NAMES.has("wp_upload_media")).toBe(true);
  });

  it("does not contain read tools", () => {
    expect(WRITE_TOOL_NAMES.has("wp_get_site_info")).toBe(false);
    expect(WRITE_TOOL_NAMES.has("wp_list_posts")).toBe(false);
    expect(WRITE_TOOL_NAMES.has("wp_get_post")).toBe(false);
    expect(WRITE_TOOL_NAMES.has("wp_list_comments")).toBe(false);
    expect(WRITE_TOOL_NAMES.has("wp_list_categories")).toBe(false);
    expect(WRITE_TOOL_NAMES.has("wp_list_tags")).toBe(false);
  });
});

describe("waitForRateLimit", () => {
  it("returns immediately when the bucket has capacity", async () => {
    vi.advanceTimersByTime(65_000);
    const result = await waitForRateLimit("read");
    expect(result.allowed).toBe(true);
  });

  it("waits for the bucket to refill, then allows", async () => {
    while (checkRateLimit("write").allowed) {
      /* drain */
    }
    const promise = waitForRateLimit("write");
    await vi.advanceTimersByTimeAsync(65_000);
    const result = await promise;
    expect(result.allowed).toBe(true);
  });
});

describe("withRetry", () => {
  it("returns the result on first success", async () => {
    const result = await withRetry(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });

  it("throws non-retryable errors immediately", async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      return Promise.reject(new Error("Bad Request"));
    };
    await expect(withRetry(fn)).rejects.toThrow("Bad Request");
    expect(attempts).toBe(1);
  });

  it.each([
    ["WordPress API 429: too many requests", "429"],
    ["WordPress API 503: service unavailable", "503"],
    ["WordPress API 502: bad gateway", "502"],
    ["Rate Limit exceeded, slow down", "rate limit (case-insensitive)"],
    ["Too Many Requests right now", "too many requests"],
  ])("retries on retryable message: %s (%s)", async (message) => {
    let attempt = 0;
    const fn = () => {
      attempt++;
      if (attempt === 1) return Promise.reject(new Error(message));
      return Promise.resolve("success");
    };

    const promise = withRetry(fn);
    await vi.advanceTimersByTimeAsync(2500);
    const result = await promise;
    expect(result).toBe("success");
    expect(attempt).toBe(2);
  });

  it("gives up after MAX_RETRIES and throws the last error", async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      return Promise.reject(new Error("429 rate limit"));
    };

    const promise = withRetry(fn);
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(promise).rejects.toThrow("429 rate limit");
    expect(attempts).toBe(4);
  });

  it("backs off exponentially: 2s, 4s, 8s", async () => {
    const timestamps: number[] = [];
    let attempt = 0;
    const fn = () => {
      timestamps.push(Date.now());
      attempt++;
      if (attempt < 4) return Promise.reject(new Error("503"));
      return Promise.resolve("done");
    };

    const promise = withRetry(fn);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;

    expect(result).toBe("done");
    expect(timestamps[1] - timestamps[0]).toBe(2000);
    expect(timestamps[2] - timestamps[1]).toBe(4000);
    expect(timestamps[3] - timestamps[2]).toBe(8000);
  });
});
