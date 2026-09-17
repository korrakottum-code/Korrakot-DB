import assert from "node:assert/strict";
import test from "node:test";

import { computeStats, MAX_GAP_MINUTES, type PancakeConversation } from "../lib/pancake.ts";

const conv = (lastCustomer: string, seenAts: string[] = []): PancakeConversation => ({
  last_customer_interactive_at: lastCustomer,
  recent_seen_users: seenAts.map((seen_at) => ({ seen_at })),
});

test("computeStats ignores conversations with no customer message", () => {
  const stats = computeStats("p1", "Test Page", [{}, {}]);
  assert.equal(stats.withCustomerMsg, 0);
  assert.equal(stats.medianMinutes, null);
  assert.equal(stats.avgMinutes, null);
});

test("computeStats counts conversations never seen by staff", () => {
  const stats = computeStats("p1", "Test Page", [
    conv("2026-09-16T10:00:00Z"),
    conv("2026-09-16T10:00:00Z", []),
  ]);
  assert.equal(stats.withCustomerMsg, 2);
  assert.equal(stats.noStaffSeenYet, 2);
  assert.equal(stats.sampleWithGap, 0);
});

test("computeStats computes the gap between last customer message and earliest staff view after it", () => {
  const stats = computeStats("p1", "Test Page", [
    // ลูกค้าทัก 10:00 แอดมินเห็น 10:05 → ห่าง 5 นาที
    conv("2026-09-16T10:00:00Z", ["2026-09-16T10:05:00Z"]),
    // แอดมินหลายคนเห็น เอาคนที่เห็นเร็วสุด (หลังลูกค้าทัก) มาคิด
    conv("2026-09-16T10:00:00Z", ["2026-09-16T10:20:00Z", "2026-09-16T10:10:00Z"]),
  ]);
  assert.equal(stats.sampleWithGap, 2);
  // sorted [5, 10] — implementation takes the upper-middle element (index length/2), not the true statistical median
  assert.equal(stats.medianMinutes, 10);
  assert.equal(stats.avgMinutes, 7.5);
});

test("computeStats drops a seen_at that happened before the customer's message", () => {
  const stats = computeStats("p1", "Test Page", [
    // แอดมินเคยเห็นบทสนทนานี้ตอน 09:00 (ก่อนลูกค้าทักข้อความล่าสุดตอน 10:00) — ไม่นับเป็นการตอบ
    conv("2026-09-16T10:00:00Z", ["2026-09-16T09:00:00Z"]),
  ]);
  assert.equal(stats.noStaffSeenYet, 1);
  assert.equal(stats.sampleWithGap, 0);
});

test("computeStats excludes gaps beyond MAX_GAP_MINUTES as stale re-opens, not slow replies", () => {
  const justUnder = new Date(0).toISOString();
  const seenAt = new Date(MAX_GAP_MINUTES * 60_000 - 60_000).toISOString();
  const seenAtOver = new Date(MAX_GAP_MINUTES * 60_000 + 60_000).toISOString();
  const stats = computeStats("p1", "Test Page", [
    conv(justUnder, [seenAt]),
    conv(justUnder, [seenAtOver]),
  ]);
  assert.equal(stats.sampleWithGap, 1);
  assert.equal(stats.noStaffSeenYet, 0); // ถูกดูจริง แค่ไม่นับใน gap เพราะเกินเพดาน
});

test("computeStats rounds median/avg to 1 decimal place", () => {
  const stats = computeStats("p1", "Test Page", [
    conv("2026-09-16T10:00:00Z", ["2026-09-16T10:01:00Z"]), // 1 min
    conv("2026-09-16T10:00:00Z", ["2026-09-16T10:02:00Z"]), // 2 min
    conv("2026-09-16T10:00:00Z", ["2026-09-16T10:04:00Z"]), // 4 min
  ]);
  assert.equal(stats.medianMinutes, 2);
  assert.equal(stats.avgMinutes, 2.3); // (1+2+4)/3 = 2.333...
});
