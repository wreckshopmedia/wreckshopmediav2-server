import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./rateLimit";

afterEach(() => {
  vi.useRealTimers();
});

describe("createRateLimiter", () => {
  it("allows requests up to the limit and blocks the next one", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });

    expect(limiter.allow("1.1.1.1")).toBe(true);
    expect(limiter.allow("1.1.1.1")).toBe(true);
    expect(limiter.allow("1.1.1.1")).toBe(true);
    expect(limiter.allow("1.1.1.1")).toBe(false);
  });

  it("counts each key separately", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });

    expect(limiter.allow("1.1.1.1")).toBe(true);
    expect(limiter.allow("1.1.1.1")).toBe(false);
    expect(limiter.allow("2.2.2.2")).toBe(true);
  });

  it("forgives a blocked key once the window rolls over", () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });

    expect(limiter.allow("1.1.1.1")).toBe(true);
    expect(limiter.allow("1.1.1.1")).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(limiter.allow("1.1.1.1")).toBe(true);
  });
});
