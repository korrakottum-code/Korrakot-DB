import assert from "node:assert/strict";
import test from "node:test";

import { fetchGraphPages } from "../lib/pagination.ts";

test("fetchGraphPages follows paging.next and returns more than 500 rows", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  const firstPage = Array.from({ length: 500 }, (_, index) => ({ id: index + 1 }));
  const secondPage = Array.from({ length: 125 }, (_, index) => ({ id: index + 501 }));

  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    return Response.json(
      url === "https://graph.facebook.com/page-2"
        ? { data: secondPage }
        : { data: firstPage, paging: { next: "https://graph.facebook.com/page-2" } }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await fetchGraphPages<{ id: number }>("https://graph.facebook.com/page-1");

  assert.equal(result.data.length, 625);
  assert.equal(result.data[0].id, 1);
  assert.equal(result.data.at(-1)?.id, 625);
  assert.deepEqual(requestedUrls, [
    "https://graph.facebook.com/page-1",
    "https://graph.facebook.com/page-2",
  ]);
});

test("fetchGraphPages stops after a page without paging.next", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return Response.json({ data: [{ id: 1 }] });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await fetchGraphPages<{ id: number }>("https://graph.facebook.com/only-page");

  assert.deepEqual(result.data, [{ id: 1 }]);
  assert.equal(requestCount, 1);
});

test("fetchGraphPages discards partial rows when Meta returns an error", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) =>
    Response.json(
      String(input).endsWith("page-2")
        ? { error: { message: "expired token" } }
        : { data: [{ id: 1 }], paging: { next: "https://graph.facebook.com/page-2" } }
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await fetchGraphPages<{ id: number }>("https://graph.facebook.com/page-1");

  assert.deepEqual(result.data, []);
  assert.equal(result.error?.message, "expired token");
});
