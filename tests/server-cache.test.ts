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
