import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { showCompletionNotification } = await jiti.import("./browser-notifications.ts");

test("opens the finished session when a completion notification is clicked", () => {
  let clicked = false;
  let title;
  let body;
  let handler;
  const delivered = showCompletionNotification("Finished", "Task complete", () => { clicked = true; }, {
    createNotification(nextTitle, options) {
      title = nextTitle;
      body = options.body;
      return { close() {}, set onclick(value) { handler = value; } };
    },
  });

  assert.equal(delivered, true);
  assert.equal(title, "Finished");
  assert.equal(body, "Task complete");
  handler();
  assert.equal(clicked, true);
});
