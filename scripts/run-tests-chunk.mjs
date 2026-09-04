#!/usr/bin/env node
// Per-file test runner + aggregator. The multi-file `node --test a b c...`
// invocation hangs in this environment, so tests run one file per process
// (the mode that works) and results are aggregated here.
import { spawnSync } from "node:child_process";

const files = process.argv.slice(2);
let pass = 0;
let fail = 0;
const failedFiles = [];
for (const file of files) {
  const res = spawnSync("node", ["--experimental-strip-types", "--test", file], {
    encoding: "utf8",
    timeout: 120_000,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const grab = (label) => {
    const m = out.match(new RegExp(`^ℹ ${label} (\\d+)`, "m"));
    return m ? Number(m[1]) : null;
  };
  const t = grab("tests");
  const p = grab("pass") ?? 0;
  const f = (grab("fail") ?? 0) + (grab("cancelled") ?? 0);
  pass += p;
  if (f > 0 || t === null) {
    fail += f;
    failedFiles.push(file);
    console.log(`FAIL: ${file} (tests=${t ?? "?"} fail=${f})`);
    const lines = out.split("\n");
    const idx = lines.findIndex((l) => l.startsWith("✖") || l.startsWith("not ok"));
    if (idx >= 0) console.log(lines.slice(Math.max(0, idx - 2), idx + 12).join("\n"));
    else console.log(out.slice(-600));
  }
}
console.log(`\ntotals: files=${files.length} pass=${pass} fail=${fail}`);
if (failedFiles.length) {
  console.log(`failed files:\n${failedFiles.join("\n")}`);
  process.exitCode = 1;
}