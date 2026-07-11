import assert from "node:assert/strict";
import test from "node:test";

import { FixedWindowRateLimiter, getRequestIp } from "../lib/rate-limit.ts";

test("fixed window limiter blocks after the limit and resets after the window", () => {
  const limiter = new FixedWindowRateLimiter();
  assert.equal(limiter.consume("client", 2, 1_000, 0).allowed, true);
  assert.equal(limiter.consume("client", 2, 1_000, 100).allowed, true);
  const blocked = limiter.consume("client", 2, 1_000, 200);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  assert.equal(limiter.consume("client", 2, 1_000, 1_001).allowed, true);
});

test("request IP uses the first forwarded address", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.10, 10.0.0.1" });
  assert.equal(getRequestIp(headers), "203.0.113.10");
});
