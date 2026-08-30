// Motion surface scanner for the 5.0 W0 animation baseline (docs 10/12).
//
// Extracts the observable animation contract of the repo — CSS keyframes,
// duration/easing tokens, inline transitions/animations, SMIL tags, reduced-
// motion blocks, theme view-transition timings and splash fade timings — as a
// plain JSON object. `scripts/motion-manifest.mjs --check` compares it with the
// committed golden; any deletion, re-timing or easing change is a deliberate
// visual change and must regenerate the golden explicitly.

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function sha(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function extractKeyframes(css) {
  const keyframes = {};
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let match;
  while ((match = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      const ch = css[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    const body = css.slice(match.index, i);
    keyframes[match[1]] = sha(body.replace(/\s+/g, " ").trim());
  }
  return keyframes;
}

function extractTokens(css) {
  const tokens = {};
  const re = /--(dur|ease)-[\w-]+:\s*([^;]+);/g;
  let match;
  while ((match = re.exec(css))) tokens[match[1] + ":" + match[0].slice(2, match[0].indexOf(":"))] = match[2].trim();
  return tokens;
}

function extractReducedMotion(css) {
  const blocks = [];
  const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  let match;
  while ((match = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      const ch = css[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    const body = css.slice(re.lastIndex, i - 1);
    blocks.push({
      line: css.slice(0, match.index).split("\n").length,
      rules: (body.match(/\}/g) ?? []).length,
      disables: [...body.matchAll(/animation(?:-name)?:\s*([\w-]+)/g)].map((m) => m[1]).sort(),
    });
  }
  return blocks;
}

function tsxFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "api") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) tsxFiles(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function scanComponent(file) {
  const src = readFileSync(file, "utf8");
  const rel = path.relative(REPO_ROOT, file).replaceAll(path.sep, "/");
  const info = { inlineTransitions: (src.match(/transition:/g) ?? []).length };
  const animations = [...src.matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1]);
  if (animations.length) info.inlineAnimations = animations;
  if (/usePrefersReducedMotion/.test(src)) info.reducedMotionHook = true;
  const smil = {
    animate: (src.match(/<animate[\s>]/g) ?? []).length,
    animateTransform: (src.match(/<animateTransform[\s>]/g) ?? []).length,
  };
  if (smil.animate || smil.animateTransform) info.smil = smil;
  // Keyframes declared inside component <style> blocks escape the globals.css
  // scan — hash them too so deletions/re-timings are detected.
  const styleBlocks = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const styleKeyframes = {};
  for (const block of styleBlocks) Object.assign(styleKeyframes, extractKeyframes(block));
  if (Object.keys(styleKeyframes).length) info.styleKeyframes = styleKeyframes;
  return [rel, info];
}

function scanDesktopMain() {
  const src = readFileSync(path.join(REPO_ROOT, "desktop", "main.js"), "utf8");
  return { keyframes: extractKeyframes(src) };
}

function scanUseTheme() {
  const src = readFileSync(path.join(REPO_ROOT, "hooks", "useTheme.ts"), "utf8");
  return {
    startViewTransition: src.includes("document.startViewTransition"),
    clipPathCircle: /clipPath:\s*\[`circle\(/.test(src),
    // Only concrete durations / easing values; bare identifiers are noise.
    timings: [
      ...src.matchAll(/duration:\s*(\d+(?:\.\d+)?(?:ms|s))|easing:\s*("(?:[^"]+)"|'(?:[^']+)'|[\w-]+\([^)]*\)|[a-z-]+(?=\s*[,})]))/g),
    ]
      .map((m) => m[1] ?? m[2])
      .sort(),
    reducedMotion: src.includes("usePrefersReducedMotion") || src.includes("prefers-reduced-motion"),
  };
}

function scanSplash() {
  const src = readFileSync(path.join(REPO_ROOT, "desktop", "splash.html"), "utf8");
  return {
    transitionDurations: [...src.matchAll(/transition:[^;]*?([\d.]+s)[^;]*;/g)].map((m) => m[1]).sort(),
    animationDurations: [...src.matchAll(/animation:[^;]*?([\d.]+s)/g)].map((m) => m[1]).sort(),
    keyframes: extractKeyframes(src) ? Object.keys(extractKeyframes(src)) : [],
  };
}

export function buildMotionManifest() {
  const css = readFileSync(path.join(REPO_ROOT, "app", "globals.css"), "utf8");
  const components = {};
  for (const dir of ["components", "hooks"]) {
    for (const file of tsxFiles(path.join(REPO_ROOT, dir))) {
      const [rel, info] = scanComponent(file);
      if (info.inlineTransitions > 0 || info.inlineAnimations || info.reducedMotionHook || info.smil)
        components[rel] = info;
    }
  }
  return {
    globals: {
      keyframes: extractKeyframes(css),
      tokens: extractTokens(css),
      transitionDeclarations: (css.match(/transition:/g) ?? []).length,
      reducedMotionBlocks: extractReducedMotion(css),
    },
    components,
    desktop: scanDesktopMain(),
    theme: scanUseTheme(),
    splash: scanSplash(),
  };
}

export function diffManifest(committed, live) {
  const problems = [];
  const j = (v) => JSON.stringify(v);
  if (j(committed.globals.keyframes) !== j(live.globals.keyframes)) {
    const gone = Object.keys(committed.globals.keyframes).filter((k) => !live.globals.keyframes[k]);
    const added = Object.keys(live.globals.keyframes).filter((k) => !committed.globals.keyframes[k]);
    const changed = Object.keys(live.globals.keyframes).filter(
      (k) => committed.globals.keyframes[k] && committed.globals.keyframes[k] !== live.globals.keyframes[k],
    );
    if (gone.length) problems.push(`keyframes deleted: ${gone.join(", ")}`);
    if (added.length) problems.push(`keyframes added: ${added.join(", ")}`);
    if (changed.length) problems.push(`keyframes re-timed/edited: ${changed.join(", ")}`);
  }
  if (j(committed.globals.tokens) !== j(live.globals.tokens))
    problems.push("duration/easing tokens changed: " + j(live.globals.tokens));
  if (committed.globals.transitionDeclarations !== live.globals.transitionDeclarations)
    problems.push(
      `globals.css transition declarations changed: ${committed.globals.transitionDeclarations} → ${live.globals.transitionDeclarations}`,
    );
  if (j(committed.globals.reducedMotionBlocks) !== j(live.globals.reducedMotionBlocks))
    problems.push("reduced-motion blocks changed (count or contents): " + j(live.globals.reducedMotionBlocks));
  for (const [file, info] of Object.entries(committed.components)) {
    if (!live.components[file]) problems.push(`motion removed from ${file}`);
    else if (j(info) !== j(live.components[file])) problems.push(`motion changed in ${file}`);
  }
  for (const file of Object.keys(live.components))
    if (!committed.components[file]) problems.push(`motion added in ${file}`);
  if (j(committed.desktop) !== j(live.desktop)) problems.push("desktop/main.js animation changed");
  if (j(committed.theme) !== j(live.theme)) problems.push("theme view-transition animation changed");
  if (j(committed.splash) !== j(live.splash)) problems.push("splash animation changed");
  return problems;
}
