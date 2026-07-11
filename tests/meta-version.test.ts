import test from "node:test";
import assert from "node:assert/strict";
import { META_GRAPH_API_BASE, META_GRAPH_API_VERSION } from "../lib/meta-version.ts";

test("all Meta reads use the explicitly pinned current Graph API version", () => {
  assert.match(META_GRAPH_API_VERSION, /^v\d+\.0$/);
  assert.equal(META_GRAPH_API_BASE, `https://graph.facebook.com/${META_GRAPH_API_VERSION}`);
  assert.notEqual(META_GRAPH_API_VERSION, "v19.0");
});
