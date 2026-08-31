import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isAttachableDragItem } = jiti("./useDragDrop.ts");

test("recognizes every file drag regardless of Explorer-provided MIME type", () => {
  for (const type of ["application/json", "video/mp2t", "application/pdf", "application/zip", ""]) {
    assert.equal(isAttachableDragItem({ kind: "file", type }), true, type || "missing MIME type");
  }
});

test("does not activate the file-drop affordance for text drags", () => {
  assert.equal(isAttachableDragItem({ kind: "string", type: "text/plain" }), false);
});
