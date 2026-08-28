import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadSubject() {
  return jiti.import("./file-access.ts");
}

test("rejects an existing path that escapes an allowed root through a symlink", async (t) => {
  const { isExistingPathWithinRoots, isPathWithinRoots } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "omp-web-file-access-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  const link = path.join(allowed, "link");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  const target = path.join(link, "secret.txt");
  const roots = new Set([allowed]);

  assert.equal(isPathWithinRoots(target, roots), true);
  assert.equal(isExistingPathWithinRoots(target, roots), false);
});

test("omp-generated image paths are exempt only in the temp dir with a whitelisted name", async (t) => {
  const { isOmpGeneratedImagePath } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "omp-web-ompimg-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, "omp-image-1568ec33559ee020.png");
  fs.writeFileSync(real, "png");
  const upper = path.join(base, "omp-image-abc123.JPG");
  fs.writeFileSync(upper, "jpg");
  const video = path.join(base, "omp-image-abc123.mp4");
  fs.writeFileSync(video, "mp4");
  const videos = ["m4v", "mov", "webm", "ogv", "mkv"].map((ext) => {
    const p = path.join(base, `omp-image-abc123.${ext}`);
    fs.writeFileSync(p, ext);
    return p;
  });

  assert.equal(isOmpGeneratedImagePath(real), true);
  assert.equal(isOmpGeneratedImagePath(upper), true);
  assert.equal(isOmpGeneratedImagePath(video), true);
  for (const p of videos) assert.equal(isOmpGeneratedImagePath(p), true, `expected ${path.basename(p)} to be exempt`);
  // Same name pattern, wrong directory.
  assert.equal(isOmpGeneratedImagePath("/Users/me/projects/omp-image-1568ec33559ee020.png"), false);
  // Wrong extension or non-hex id (files exist so realpath passes).
  const txt = path.join(base, "omp-image-1568ec33559ee020.txt");
  fs.writeFileSync(txt, "txt");
  const nonhex = path.join(base, "omp-image-nothex.png");
  fs.writeFileSync(nonhex, "png");
  assert.equal(isOmpGeneratedImagePath(txt), false);
  assert.equal(isOmpGeneratedImagePath(nonhex), false);
  // Arbitrary temp files stay blocked.
  const secret = path.join(base, "secret.txt");
  fs.writeFileSync(secret, "secret");
  assert.equal(isOmpGeneratedImagePath(secret), false);
});

test("exemption resolves realpath so a temp symlink cannot escape the temp dir", async (t) => {
  const { isOmpGeneratedImagePath } = await loadSubject();
  // Target is a file OUTSIDE the temp dir (/etc/passwd is outside any tmp
  // spelling on macOS/Linux); the symlink name matches the whitelist and
  // lives inside the temp dir.
  const link = path.join(os.tmpdir(), `omp-image-${crypto.randomBytes(4).toString("hex")}.png`);
  t.after(() => { try { fs.unlinkSync(link); } catch {} });
  fs.symlinkSync("/etc/passwd", link);

  // realpath of the link is /etc/passwd, so the temp-dir containment fails.
  assert.equal(isOmpGeneratedImagePath(link), false);
});

test("exemption joins through macOS /tmp -> /private/tmp aliasing", async (t) => {
  const { isOmpGeneratedImagePath } = await loadSubject();
  const realTmp = fs.realpathSync(os.tmpdir());
  const base = fs.mkdtempSync(path.join(realTmp, "omp-web-ompimg-alias-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const file = path.join(base, "omp-image-1568ec33559ee020.png");
  fs.writeFileSync(file, "png");

  const candidates = [os.tmpdir(), "/tmp", "/private/tmp", ...(process.env.TMPDIR ? [process.env.TMPDIR] : [])];
  for (const candidate of new Set(candidates)) {
    if (!candidate) continue;
    const rel = path.relative(realTmp, base);
    if (rel.startsWith("..")) continue; // not an alias of the real temp dir
    const aliased = path.join(candidate, rel);
    if (!fs.existsSync(aliased)) continue;
    assert.equal(isOmpGeneratedImagePath(path.join(aliased, "omp-image-1568ec33559ee020.png")), true);
  }
});

test("exemption rejects a same-named directory (not a generated image)", async (t) => {
  const { isOmpGeneratedImagePath } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "omp-web-ompimg-dir-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const dir = path.join(base, "omp-image-1568ec33559ee020.png");
  fs.mkdirSync(dir);
  assert.equal(isOmpGeneratedImagePath(dir), false);
});
