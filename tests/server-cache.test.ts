import assert from "node:assert/strict";
import test from "node:test";

import { clearServerCache, getServerCache } from "../lib/server-cache.ts";

test("getServerCache reuses a fresh value and shares concurrent loads", async () => {
  clearServerCache();
  let loadCount = 0;
  let releaseLoader: (() => void) | undefined;
  const loaderReady = new Promise<void>((resolve) => { releaseLoader = resolve; });
  const loader = async () => {
    loadCount += 1;
    await loaderReady;
    return { value: 42 };
  };

  const first = getServerCache("shared", 60_000, loader);
  const second = getServerCache("shared", 60_000, loader);
  releaseLoader?.();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(loadCount, 1);
  assert.deepEqual(firstResult.value, { value: 42 });
  assert.deepEqual(secondResult.value, { value: 42 });
  assert.equal(secondResult.hit, true);

  const cached = await getServerCache("shared", 60_000, loader);
  assert.equal(cached.hit, true);
  assert.equal(loadCount, 1);
});

test("getServerCache forceRefresh bypasses the existing value", async () => {
  clearServerCache();
  let loadCount = 0;
  const loader = async () => ({ value: ++loadCount });

  assert.equal((await getServerCache("force", 60_000, loader)).value.value, 1);
  const refreshed = await getServerCache("force", 60_000, loader, true);

  assert.equal(refreshed.value.value, 2);
  assert.equal(refreshed.hit, false);
});

const tick = () => new Promise((r) => setTimeout(r, 10));

test("getServerCache serves stale value immediately and refreshes in the background", async () => {
  clearServerCache();
  let loadCount = 0;
  const loader = async () => ({ value: ++loadCount });

  // ttl 0 → หมดอายุทันที แต่ staleTtlMs ยาว → ต้องได้ค่าเก่าทันทีพร้อม stale flag
  await getServerCache("swr", 0, loader);
  const staleResult = await getServerCache("swr", 0, loader, false, { staleTtlMs: 60_000 });

  assert.equal(staleResult.value.value, 1);
  assert.equal(staleResult.hit, true);
  assert.equal(staleResult.stale, true);

  await tick(); // ให้ background refresh ทำงานจบ
  assert.equal(loadCount, 2);
});

test("getServerCache does not stack duplicate background refreshes", async () => {
  clearServerCache();
  let loadCount = 0;
  let releaseLoader: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { releaseLoader = resolve; });
  const loader = async () => {
    loadCount += 1;
    if (loadCount > 1) await gate;
    return { value: loadCount };
  };

  await getServerCache("swr-dedupe", 0, loader);
  await getServerCache("swr-dedupe", 0, loader, false, { staleTtlMs: 60_000 });
  await getServerCache("swr-dedupe", 0, loader, false, { staleTtlMs: 60_000 });
  await getServerCache("swr-dedupe", 0, loader, false, { staleTtlMs: 60_000 });

  releaseLoader?.();
  await tick();
  assert.equal(loadCount, 2); // 1 โหลดแรก + 1 background refresh เดียว ไม่ซ้อน
});

test("getServerCache keeps serving stale value when background refresh fails", async () => {
  clearServerCache();
  let loadCount = 0;
  const loader = async () => {
    loadCount += 1;
    if (loadCount > 1) throw new Error("Meta down");
    return { value: 1 };
  };

  await getServerCache("swr-fail", 0, loader);
  const first = await getServerCache("swr-fail", 0, loader, false, { staleTtlMs: 60_000 });
  assert.equal(first.value.value, 1);
  assert.equal(first.stale, true);

  await tick();
  // refresh พังไปแล้ว แต่ค่าเก่าต้องยังเสิร์ฟได้อยู่
  const second = await getServerCache("swr-fail", 0, loader, false, { staleTtlMs: 60_000 });
  assert.equal(second.value.value, 1);
  assert.equal(second.stale, true);
});

test("getServerCache waits for the loader once the stale window has passed", async () => {
  clearServerCache();
  let loadCount = 0;
  const loader = async () => ({ value: ++loadCount });

  await getServerCache("swr-expired", 0, loader);
  await tick();
  // staleTtlMs 1ms ผ่านไปแล้ว → ต้องรอโหลดใหม่ ไม่เสิร์ฟค่าเก่า
  const result = await getServerCache("swr-expired", 0, loader, false, { staleTtlMs: 1 });
  assert.equal(result.value.value, 2);
  assert.equal(result.hit, false);
  assert.equal(result.stale, undefined);
});
