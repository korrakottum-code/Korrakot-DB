import assert from "node:assert/strict";
import test from "node:test";

import { computeStats, computeAdminStats, bangkokDayRangeMs, MAX_GAP_MINUTES, type PancakeConversation } from "../lib/pancake.ts";

// Pancake ส่ง timestamp แบบ naive ไม่มี Z/offset ต่อท้าย (เช่น "2026-09-17T03:53:00") แต่ค่าจริงคือ
// เวลา Bangkok local — fixture ทุกตัวในไฟล์นี้จึงตั้งใจไม่ใส่ Z ให้ตรงกับข้อมูลจริงที่ API ส่งมา
const conv = (lastCustomer: string, seenAts: string[] = []): PancakeConversation => ({
  last_customer_interactive_at: lastCustomer,
  recent_seen_users: seenAts.map((seen_at) => ({ seen_at })),
});

const convBy = (
  lastCustomer: string,
  seen: Array<{ seen_at: string; fb_id: string; fb_name: string }>
): PancakeConversation => ({
  last_customer_interactive_at: lastCustomer,
  recent_seen_users: seen,
});

test("computeStats ignores conversations with no customer message", () => {
  const stats = computeStats("p1", "Test Page", [{}, {}]);
  assert.equal(stats.withCustomerMsg, 0);
  assert.equal(stats.medianMinutes, null);
  assert.equal(stats.avgMinutes, null);
});

test("computeStats counts conversations never seen by staff", () => {
  const stats = computeStats("p1", "Test Page", [
    conv("2026-09-16T10:00:00"),
    conv("2026-09-16T10:00:00", []),
  ]);
  assert.equal(stats.withCustomerMsg, 2);
  assert.equal(stats.noStaffSeenYet, 2);
  assert.equal(stats.sampleWithGap, 0);
});

test("computeStats computes the gap between last customer message and earliest staff view after it", () => {
  const stats = computeStats("p1", "Test Page", [
    // ลูกค้าทัก 10:00 แอดมินเห็น 10:05 → ห่าง 5 นาที
    conv("2026-09-16T10:00:00", ["2026-09-16T10:05:00"]),
    // แอดมินหลายคนเห็น เอาคนที่เห็นเร็วสุด (หลังลูกค้าทัก) มาคิด
    conv("2026-09-16T10:00:00", ["2026-09-16T10:20:00", "2026-09-16T10:10:00"]),
  ]);
  assert.equal(stats.sampleWithGap, 2);
  // sorted [5, 10] — implementation takes the upper-middle element (index length/2), not the true statistical median
  assert.equal(stats.medianMinutes, 10);
  assert.equal(stats.avgMinutes, 7.5);
});

test("computeStats drops a seen_at that happened before the customer's message", () => {
  const stats = computeStats("p1", "Test Page", [
    // แอดมินเคยเห็นบทสนทนานี้ตอน 09:00 (ก่อนลูกค้าทักข้อความล่าสุดตอน 10:00) — ไม่นับเป็นการตอบ
    conv("2026-09-16T10:00:00", ["2026-09-16T09:00:00"]),
  ]);
  assert.equal(stats.noStaffSeenYet, 1);
  assert.equal(stats.sampleWithGap, 0);
});

test("computeStats excludes gaps beyond MAX_GAP_MINUTES as stale re-opens, not slow replies", () => {
  const gapMs = MAX_GAP_MINUTES * 60_000;
  const base = new Date(Date.UTC(2026, 0, 1)); // จุดอ้างอิงล้วนๆ ไม่เกี่ยวกับ Bangkok — แค่ทดสอบเพดาน gap
  const asNaive = (d: Date) => d.toISOString().slice(0, 19);
  const stats = computeStats("p1", "Test Page", [
    conv(asNaive(base), [asNaive(new Date(base.getTime() + gapMs - 60_000))]),
    conv(asNaive(base), [asNaive(new Date(base.getTime() + gapMs + 60_000))]),
  ]);
  assert.equal(stats.sampleWithGap, 1);
  assert.equal(stats.noStaffSeenYet, 0); // ถูกดูจริง แค่ไม่นับใน gap เพราะเกินเพดาน
});

test("computeStats rounds median/avg to 1 decimal place", () => {
  const stats = computeStats("p1", "Test Page", [
    conv("2026-09-16T10:00:00", ["2026-09-16T10:01:00"]), // 1 min
    conv("2026-09-16T10:00:00", ["2026-09-16T10:02:00"]), // 2 min
    conv("2026-09-16T10:00:00", ["2026-09-16T10:04:00"]), // 4 min
  ]);
  assert.equal(stats.medianMinutes, 2);
  assert.equal(stats.avgMinutes, 2.3); // (1+2+4)/3 = 2.333...
});

// กันบั๊กที่เจอจริงบน production: new Date(naiveString) ตีความตาม system timezone ของเครื่องที่รันโค้ด
// (dev machine ตั้งเป็นไทยพอดีเลยดูถูกโดยบังเอิญ, Vercel serverless default UTC ทำให้เพี้ยนไป 7 ชม.)
// ต้องบังคับตีความเป็น Bangkok เสมอไม่ว่า process จะรันด้วย system timezone ไหน
test("computeStats treats naive Pancake timestamps as Bangkok time, not the process's system timezone", () => {
  const dayRange = bangkokDayRangeMs("2026-09-17");
  const stats = computeStats(
    "p1",
    "Test Page",
    [
      // 23:30 คืนวันที่ 16 (Bangkok) — ยังเป็นเมื่อวาน ต้องไม่นับเข้าวันที่ 17
      conv("2026-09-16T23:30:00", ["2026-09-16T23:35:00"]),
      // 00:30 เช้าวันที่ 17 (Bangkok) — เข้าเกณฑ์วันที่ 17 แล้ว
      conv("2026-09-17T00:30:00", ["2026-09-17T00:40:00"]),
    ],
    dayRange
  );
  assert.equal(stats.withCustomerMsg, 1, "ต้องนับแค่บทสนทนาของวันที่ 17 เท่านั้น ไม่ปนเมื่อคืนวันที่ 16");
  assert.equal(stats.medianMinutes, 10);
});

test("bangkokDayRangeMs is independent of the process's system timezone (Bangkok is UTC+7 always, no DST)", () => {
  const { sinceMs, untilMs } = bangkokDayRangeMs("2026-09-17");
  assert.equal(new Date(sinceMs).toISOString(), "2026-09-16T17:00:00.000Z");
  assert.equal(new Date(untilMs).toISOString(), "2026-09-17T17:00:00.000Z");
});

test("computeAdminStats only counts conversations that were actually replied to", () => {
  const dayRange = bangkokDayRangeMs("2026-09-17");
  const stats = computeAdminStats(
    [
      convBy("2026-09-17T09:00:00", [{ seen_at: "2026-09-17T09:05:00", fb_id: "u1", fb_name: "Ammy" }]),
      conv("2026-09-17T09:00:00"), // ยังไม่มีใครดูเลย — ไม่นับ
    ],
    dayRange
  );
  assert.equal(stats.length, 1);
  assert.equal(stats[0].adminName, "Ammy");
  assert.equal(stats[0].count, 1);
  assert.equal(stats[0].medianMinutes, 5);
});

test("computeAdminStats credits only the first (fastest) responder when several admins viewed the same conversation", () => {
  const dayRange = bangkokDayRangeMs("2026-09-17");
  const stats = computeAdminStats(
    [
      convBy("2026-09-17T09:00:00", [
        { seen_at: "2026-09-17T09:20:00", fb_id: "u2", fb_name: "Bee" },
        { seen_at: "2026-09-17T09:05:00", fb_id: "u1", fb_name: "Ammy" }, // เร็วสุด — ได้เครดิต
      ]),
    ],
    dayRange
  );
  assert.equal(stats.length, 1);
  assert.equal(stats[0].adminName, "Ammy");
  assert.equal(stats[0].adminId, "u1");
});

test("computeAdminStats aggregates multiple conversations per admin across pages (median/avg/count)", () => {
  const dayRange = bangkokDayRangeMs("2026-09-17");
  const stats = computeAdminStats(
    [
      convBy("2026-09-17T09:00:00", [{ seen_at: "2026-09-17T09:02:00", fb_id: "u1", fb_name: "Ammy" }]), // 2 min
      convBy("2026-09-17T10:00:00", [{ seen_at: "2026-09-17T10:04:00", fb_id: "u1", fb_name: "Ammy" }]), // 4 min
      convBy("2026-09-17T11:00:00", [{ seen_at: "2026-09-17T11:30:00", fb_id: "u2", fb_name: "Bee" }]), // 30 min
    ],
    dayRange
  );
  const ammy = stats.find((s) => s.adminId === "u1")!;
  const bee = stats.find((s) => s.adminId === "u2")!;
  assert.equal(ammy.count, 2);
  assert.equal(ammy.medianMinutes, 4); // sorted [2,4] → index 1
  assert.equal(ammy.avgMinutes, 3);
  assert.equal(bee.count, 1);
  assert.equal(bee.medianMinutes, 30);
});

test("computeAdminStats respects the same Bangkok day-range filter as computeStats", () => {
  const dayRange = bangkokDayRangeMs("2026-09-17");
  const stats = computeAdminStats(
    [
      // 23:30 คืนวันที่ 16 (Bangkok) — เมื่อวาน ไม่นับเข้าวันที่ 17
      convBy("2026-09-16T23:30:00", [{ seen_at: "2026-09-16T23:35:00", fb_id: "u1", fb_name: "Ammy" }]),
    ],
    dayRange
  );
  assert.equal(stats.length, 0);
});
