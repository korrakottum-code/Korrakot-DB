import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedMetaMediaUrl, isSameOriginRequest } from "../lib/security.ts";

test("media proxy only allows HTTPS Meta-owned hosts", () => {
  assert.equal(isAllowedMetaMediaUrl("https://scontent.fbkk1-1.fna.fbcdn.net/image.jpg"), true);
  assert.equal(isAllowedMetaMediaUrl("https://platform-lookaside.fbsbx.com/image.jpg"), true);
  assert.equal(isAllowedMetaMediaUrl("https://graph.facebook.com/image.jpg"), true);
  assert.equal(isAllowedMetaMediaUrl("http://scontent.fbcdn.net/image.jpg"), false);
  assert.equal(isAllowedMetaMediaUrl("https://fbcdn.net.evil.example/image.jpg"), false);
  assert.equal(isAllowedMetaMediaUrl("https://127.0.0.1/image.jpg"), false);
  assert.equal(isAllowedMetaMediaUrl("https://user:pass@fbcdn.net/image.jpg"), false);
});

test("state-changing auth requests require the exact same origin", () => {
  assert.equal(isSameOriginRequest("https://dashboard.example/login", "https://dashboard.example"), true);
  assert.equal(isSameOriginRequest("https://dashboard.example/login", "https://evil.example"), false);
  assert.equal(isSameOriginRequest("https://dashboard.example/login", null), false);
});

test("isSameOriginRequest accepts Host header match for proxy scenarios", () => {
  assert.equal(
    isSameOriginRequest("http://localhost:3000/api/auth/login", "http://127.0.0.1:60207", "127.0.0.1:60207"),
    true
  );
  assert.equal(
    isSameOriginRequest("http://localhost:3000/api/auth/login", "http://127.0.0.1:60207", "localhost:3000"),
    false
  );
  assert.equal(
    isSameOriginRequest("http://localhost:3000/api/auth/login", "http://evil.example", "127.0.0.1:60207"),
    false
  );
});
