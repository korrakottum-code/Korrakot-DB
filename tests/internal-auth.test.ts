import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionToken,
  readInternalAuthConfig,
  safeRedirectPath,
  verifyPassword,
  verifySessionToken,
} from "../lib/internal-auth.ts";

const config = {
  password: "a-secure-team-password",
  secret: "a-secret-that-is-definitely-longer-than-thirty-two-characters",
};

test("internal auth config fails closed when secrets are missing or weak", () => {
  assert.equal(readInternalAuthConfig({}).ok, false);
  assert.equal(readInternalAuthConfig({ INTERNAL_DASHBOARD_PASSWORD: "short" }).ok, false);
  assert.equal(readInternalAuthConfig({
    INTERNAL_DASHBOARD_PASSWORD: config.password,
    INTERNAL_DASHBOARD_SECRET: "too-short",
  }).ok, false);
  assert.equal(readInternalAuthConfig({
    INTERNAL_DASHBOARD_PASSWORD: config.password,
    INTERNAL_DASHBOARD_SECRET: config.secret,
  }).ok, true);
});

test("session tokens expire and are invalidated when credentials change", () => {
  const now = Date.UTC(2026, 6, 11);
  const token = createSessionToken(config, now, 60);

  assert.equal(verifySessionToken(token, config, now + 30_000), true);
  assert.equal(verifySessionToken(token, config, now + 61_000), false);
  assert.equal(verifySessionToken(`${token}x`, config, now), false);
  assert.equal(verifySessionToken(token, { ...config, password: `${config.password}-new` }, now), false);
  assert.equal(verifySessionToken(token, { ...config, secret: `${config.secret}-new` }, now), false);
});

test("password verification and redirect paths reject unsafe input", () => {
  assert.equal(verifyPassword(config.password, config.password), true);
  assert.equal(verifyPassword("wrong-password", config.password), false);
  assert.equal(safeRedirectPath("/ads?date=today"), "/ads?date=today");
  assert.equal(safeRedirectPath("https://evil.example"), "/");
  assert.equal(safeRedirectPath("//evil.example"), "/");
  assert.equal(safeRedirectPath("/\\evil.example"), "/");
  assert.equal(safeRedirectPath("/login?next=/ads"), "/");
});
