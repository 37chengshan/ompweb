import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { splitPathTokens, remarkPathLinks } = await jiti.import("./markdown-path-links.ts");

function pathTokens(text) {
  return splitPathTokens(text).filter((t) => t.isPath).map((t) => t.text);
}

test("links rooted absolute paths on macOS and Linux", () => {
  assert.deepEqual(pathTokens("see /Users/cc/code/ompweb/docs/plan.md"), ["/Users/cc/code/ompweb/docs/plan.md"]);
  assert.deepEqual(pathTokens("/tmp/omp-image-1568ec33559ee020.png"), ["/tmp/omp-image-1568ec33559ee020.png"]);
  assert.deepEqual(pathTokens("/etc/hosts and /var/log/sys.log"), ["/etc/hosts", "/var/log/sys.log"]);
});

test("links Windows drive, UNC, and home paths", () => {
  assert.deepEqual(pathTokens("C:\\Users\\32796\\file.md"), ["C:\\Users\\32796\\file.md"]);
  assert.deepEqual(pathTokens("open C:/Users/x/plan.md now"), ["C:/Users/x/plan.md"]);
  assert.deepEqual(pathTokens("\\\\server\\share\\f.txt"), ["\\\\server\\share\\f.txt"]);
  assert.deepEqual(pathTokens("~/.config/omp/config.yml"), ["~/.config/omp/config.yml"]);
  assert.deepEqual(pathTokens("cp ../src/main.ts"), ["../src/main.ts"]);
});

test("links relative multi-segment paths with extensions", () => {
  assert.deepEqual(pathTokens("docs/plans/2026-08-13-dashboard-v4-ui-plan.md"), ["docs/plans/2026-08-13-dashboard-v4-ui-plan.md"]);
  assert.deepEqual(pathTokens("lib/file-access.ts and components/FileViewer.tsx"), ["lib/file-access.ts", "components/FileViewer.tsx"]);
  assert.deepEqual(pathTokens("详见 docs/plans/a.md"), ["docs/plans/a.md"]);
});

test("never links URLs, dates, plain words, or extension-less fragments", () => {
  assert.deepEqual(pathTokens("visit https://example.com/a/b"), []);
  assert.deepEqual(pathTokens("http://localhost:3000/x"), []);
  assert.deepEqual(pathTokens("2026-08-13 dashboard-v4"), []);
  assert.deepEqual(pathTokens("and/or"), []);
  assert.deepEqual(pathTokens("foo/bar"), []);
  assert.deepEqual(pathTokens("hello world"), []);
  assert.deepEqual(pathTokens("npm run dev"), []);
  assert.deepEqual(pathTokens("HTTP/1.1 200 OK"), []);
  assert.deepEqual(pathTokens("v2/3.0 and 1.1/2.0"), []);
});

test("keeps surrounding text and preserves order in mixed content", () => {
  const tokens = splitPathTokens("看看 /Users/cc/x.md 和 docs/plans/y.md 文件");
  assert.deepEqual(tokens, [
    { text: "看看 ", isPath: false },
    { text: "/Users/cc/x.md", isPath: true },
    { text: " 和 ", isPath: false },
    { text: "docs/plans/y.md", isPath: true },
    { text: " 文件", isPath: false },
  ]);
});

test("remark plugin rewrites bare paths into link nodes", () => {
  const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "open /tmp/omp-image-1.png now" }] }] };
  remarkPathLinks()(tree);
  const children = tree.children[0].children;
  assert.equal(children.length, 3);
  assert.equal(children[0].value, "open ");
  assert.equal(children[1].type, "link");
  assert.equal(children[1].url, "/tmp/omp-image-1.png");
  assert.equal(children[2].value, " now");
  // Link text was NOT rewritten again (no nesting).
  assert.equal(children[1].children.length, 1);
  assert.equal(children[1].children[0].type, "text");
});
test("inline-code paths become links; block code and commands stay text", () => {
  const tree = {
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "inlineCode", value: "docs/plans/2026-08-13-dashboard-v4-ui-plan.md" }] },
      { type: "paragraph", children: [{ type: "inlineCode", value: "npm run dev" }] },
      { type: "code", value: "/Users/cc/code/x.ts" },
    ],
  };
  remarkPathLinks()(tree);
  const p1 = tree.children[0].children;
  assert.equal(p1.length, 1);
  assert.equal(p1[0].type, "link");
  assert.equal(p1[0].url, "docs/plans/2026-08-13-dashboard-v4-ui-plan.md");
  // Command inline code untouched.
  assert.equal(tree.children[1].children[0].type, "inlineCode");
  // Block code untouched.
  assert.equal(tree.children[2].type, "code");
});
