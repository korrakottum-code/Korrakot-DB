import assert from "node:assert/strict";
import test from "node:test";

import { groupCreativeRequests, normalizeAccountId } from "../lib/creative-routing.ts";

test("normalizeAccountId accepts Meta act_ ids and plain ids", () => {
  assert.equal(normalizeAccountId("act_123"), "123");
  assert.equal(normalizeAccountId("123"), "123");
});

test("groupCreativeRequests routes each account to its owning token", () => {
  const groups = groupCreativeRequests(
    ["ad-1", "ad-2", "ad-3"],
    ["act_1", "2", "unknown"],
    { "1": "token-a", "2": "token-b" },
    "token-a"
  );

  assert.deepEqual(groups, [
    { token: "token-a", adIds: ["ad-1", "ad-3"], accountIds: ["1", "unknown"] },
    { token: "token-b", adIds: ["ad-2"], accountIds: ["2"] },
  ]);
});
