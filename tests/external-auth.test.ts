import assert from "node:assert/strict";
import test from "node:test";

import { readExternalApiKey, readExternalApiKeys, verifyAnyExternalApiKey, verifyExternalApiKey } from "../lib/external-auth.ts";

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

const otherKey = "another-secret-that-is-also-longer-than-thirty-two-characters";

test("readExternalApiKeys: รหัสเดิมยังใช้ได้เหมือนเดิม และรหัสแยกรายผู้เรียกเป็นทางเลือกเพิ่ม", () => {
  assert.deepEqual(readExternalApiKeys({}), []);
  assert.deepEqual(readExternalApiKeys({ EXTERNAL_API_KEY: validKey }), [validKey]);
  assert.deepEqual(readExternalApiKeys({ EXTERNAL_API_KEY: validKey, EXTERNAL_API_KEY_QLASS: otherKey }), [validKey, otherKey]);
  // มีแค่รหัสแยกก็ใช้ได้ (ตัวหลักยังไม่ได้ตั้ง)
  assert.deepEqual(readExternalApiKeys({ EXTERNAL_API_KEY_QLASS: otherKey }), [otherKey]);
});

test("readExternalApiKeys: รหัสสั้นเกินไปหรือซ้ำกับตัวหลักไม่ถูกนับ (fail-closed)", () => {
  assert.deepEqual(readExternalApiKeys({ EXTERNAL_API_KEY: validKey, EXTERNAL_API_KEY_QLASS: "short" }), [validKey]);
  assert.deepEqual(readExternalApiKeys({ EXTERNAL_API_KEY: validKey, EXTERNAL_API_KEY_QLASS: validKey }), [validKey]);
  assert.deepEqual(readExternalApiKeys({ EXTERNAL_API_KEY_QLASS: "short" }), []);
});

test("verifyAnyExternalApiKey: ตรงกับรหัสใดรหัสหนึ่งก็ผ่าน นอกนั้นไม่ผ่าน", () => {
  const keys = [validKey, otherKey];
  assert.equal(verifyAnyExternalApiKey(validKey, keys), true);
  assert.equal(verifyAnyExternalApiKey(otherKey, keys), true);
  assert.equal(verifyAnyExternalApiKey(`${otherKey}x`, keys), false);
  assert.equal(verifyAnyExternalApiKey("wrong-key-of-any-length-here", keys), false);
  assert.equal(verifyAnyExternalApiKey(null, keys), false);
  assert.equal(verifyAnyExternalApiKey("", keys), false);
  // ไม่มีรหัสที่ตั้งไว้เลย ห้ามผ่านแม้ส่งอะไรมา
  assert.equal(verifyAnyExternalApiKey(validKey, []), false);
});
