// OMP 原生设置描述提取与校验脚本（5.1 汉化收口）。
//
//   node scripts/gen-native-settings-descriptions.mjs           → 重写 lib/omp/settings-descriptions.en.txt
//   node scripts/gen-native-settings-descriptions.mjs --check   → 校验 zh.ts 覆盖 en.txt，缺失则 exit 1
//
// en.txt 是按字母排序的唯一英文描述列表（每行一条 JSON 字符串），
// 用于 review 翻译覆盖、做 git diff、防止 schema 增长后漏翻。
// 翻译本身在 lib/omp/settings-descriptions-zh.ts 里维护，脚本不写 zh.ts。

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..");
const enPath = path.join(repoRoot, "lib", "omp", "settings-descriptions.en.txt");
const zhPath = path.join(repoRoot, "lib", "omp", "settings-descriptions-zh.ts");

const execFileAsync = promisify(execFile);

async function runOmp(args) {
  const ompBin = process.env.OMP_WEB_OMP_BIN ?? "omp";
  const { stdout } = await execFileAsync(ompBin, args, {
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

async function collectDescriptions() {
  const stdout = await runOmp(["config", "list", "--json"]);
  const parsed = JSON.parse(stdout);
  const set = new Set();
  for (const entry of Object.values(parsed)) {
    if (entry && typeof entry === "object" && typeof entry.description === "string" && entry.description.trim()) {
      set.add(entry.description);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function readZhKeys() {
  const src = readFileSync(zhPath, "utf8");
  const keys = new Set();
  for (const m of src.matchAll(/"((?:[^"\\]|\\.)*)":\s*"/g)) {
    keys.add(JSON.parse(`"${m[1]}"`));
  }
  return keys;
}

async function regenerate() {
  const descs = await collectDescriptions();
  const content = descs.map((d) => JSON.stringify(d)).join("\n") + "\n";
  writeFileSync(enPath, content, "utf8");
  console.log(`Wrote ${descs.length} descriptions to lib/omp/settings-descriptions.en.txt`);
}

async function check() {
  const descs = await collectDescriptions();
  const zhKeys = readZhKeys();
  const missing = descs.filter((d) => !zhKeys.has(d));
  if (missing.length > 0) {
    console.error(`FAIL: ${missing.length} description(s) missing from zh.ts:`);
    for (const d of missing) console.error(`  - ${d}`);
    process.exit(1);
  }
  console.log(`OK: all ${descs.length} descriptions covered in zh.ts`);
}

const checkMode = process.argv.includes("--check");
if (checkMode) await check();
else await regenerate();
