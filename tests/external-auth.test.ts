import assert from "node:assert/strict";
import test from "node:test";

import { readExternalApiKey, verifyExternalApiKey } from "../lib/external-auth.ts";

const validKey = "a-secret-that-is-definitely-longer-than-thirty-two-characters";

test("readExternalApiKey fails closed when missing or too short", () => {
  assert.equal(readExternalApiKey({}), null);
  assert.equal(readExternalApiKey({ EXTERNAL_API_KEY: "short" }), null);
  assert.equal(readExternalApiKey({ EXTERNAL_API_KEY: validKey }), validKey);
});

test("verifyExternalApiKey matches only the exact key and rejects missing input", () => {
  assert.equal(verifyExternalApiKey(validKey, validKey), true);
  assert.equal(verifyExternalApiKey(`${validKey}x`, validKey), false);
  assert.equal(verifyExternalApiKey("wrong-key-of-any-length-here", validKey), false);
  assert.equal(verifyExternalApiKey(null, validKey), false);
  assert.equal(verifyExternalApiKey("", validKey), false);
});
