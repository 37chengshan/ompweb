import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./chat-attachments.ts");
}

function textFile(name, type = "") {
  return { name, type };
}

test("recognizes text and markdown attachments by mime or extension", async () => {
  const { isTextAttachmentFile } = await loadSubject();

  assert.equal(isTextAttachmentFile(textFile("notes.txt", "text/plain")), true);
  assert.equal(isTextAttachmentFile(textFile("README.md", "text/markdown")), true);
  assert.equal(isTextAttachmentFile(textFile("README.MD")), true);
  assert.equal(isTextAttachmentFile(textFile("doc.markdown")), true);
  assert.equal(isTextAttachmentFile(textFile("page.mdx")), true);
  assert.equal(isTextAttachmentFile(textFile("data.json", "application/json")), false);
  assert.equal(isTextAttachmentFile(textFile("image.png", "image/png")), false);
  assert.equal(isTextAttachmentFile(textFile("noextension")), false);
});

test("composes message with attachment blocks and escapes triple backticks", async () => {
  const { composeMessageWithTextAttachments } = await loadSubject();

  assert.equal(composeMessageWithTextAttachments("hello", []), "hello");

  const result = composeMessageWithTextAttachments("  ", [
    { name: "notes.txt", mimeType: "text/plain", content: "line one", size: 8 },
  ]);
  assert.equal(
    result,
    "Attached file: notes.txt\n```text\nline one\n```",
  );

  // Content containing ``` must not break the code fence — the fence grows.
  const backticks = composeMessageWithTextAttachments("", [
    { name: "README.md", mimeType: "text/markdown", content: "```js\ncode\n```", size: 15 },
  ]);
  assert.equal(
    backticks,
    "Attached file: README.md\n````markdown\n```js\ncode\n```\n````",
  );
});

test("keeps message text above attachment blocks", async () => {
  const { composeMessageWithTextAttachments } = await loadSubject();

  const result = composeMessageWithTextAttachments("Review this", [
    { name: "a.md", mimeType: "text/markdown", content: "A", size: 1 },
    { name: "b.txt", mimeType: "text/plain", content: "B", size: 1 },
  ]);

  assert.ok(result.startsWith("Review this\n\nAttached file: a.md"));
  assert.ok(result.includes("Attached file: b.md") === false);
  assert.ok(result.includes("Attached file: b.txt"));
});
