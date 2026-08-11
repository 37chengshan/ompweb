// Shared PrismLight setup: registers a curated grammar set instead of the full
// Prism build, which bundles all ~600 refractor grammars plus the entire CJS
// theme barrel. The most common fence/file languages are registered eagerly;
// rarer grammars load on demand via ensureLanguageRegistered. Unregistered
// fence languages fall back to plain text without console noise (the
// highlighter catches the unknown-language error itself).
import type { CSSProperties } from "react";
import createSyntaxElement from "react-syntax-highlighter/dist/esm/create-element";
import PrismLight from "react-syntax-highlighter/dist/esm/prism-light";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import vsTheme from "react-syntax-highlighter/dist/esm/styles/prism/vs";
import vscDarkPlusTheme from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus";

// Eagerly registered grammars: the fence/file languages that dominate real
// sessions (shell, JS/TS/JSX, JSON, markdown/markup, python, yaml, diff, docker).
const CORE_GRAMMARS: Record<string, unknown> = {
  bash, css, diff, docker, javascript, json, jsx, markdown, markup, python,
  tsx, typescript, yaml,
};

for (const [name, grammar] of Object.entries(CORE_GRAMMARS)) {
  PrismLight.registerLanguage(name, grammar);
}

// Canonical names we have registered (core + lazily loaded). Mirrors the
// runtime state of PrismLight.languages without relying on untyped internals.
const registered = new Set(Object.keys(CORE_GRAMMARS));

// Rarely-hit grammars loaded on demand. Grammar modules carry their own
// aliases (ts, py, sh, html, yml, dockerfile, ...) and register their own
// dependencies, so registering under the canonical name is enough.
const LAZY_GRAMMARS: Record<string, () => Promise<{ default: unknown }>> = {
  c: () => import("react-syntax-highlighter/dist/esm/languages/prism/c"),
  cpp: () => import("react-syntax-highlighter/dist/esm/languages/prism/cpp"),
  csharp: () => import("react-syntax-highlighter/dist/esm/languages/prism/csharp"),
  go: () => import("react-syntax-highlighter/dist/esm/languages/prism/go"),
  graphql: () => import("react-syntax-highlighter/dist/esm/languages/prism/graphql"),
  hcl: () => import("react-syntax-highlighter/dist/esm/languages/prism/hcl"),
  ini: () => import("react-syntax-highlighter/dist/esm/languages/prism/ini"),
  java: () => import("react-syntax-highlighter/dist/esm/languages/prism/java"),
  kotlin: () => import("react-syntax-highlighter/dist/esm/languages/prism/kotlin"),
  makefile: () => import("react-syntax-highlighter/dist/esm/languages/prism/makefile"),
  protobuf: () => import("react-syntax-highlighter/dist/esm/languages/prism/protobuf"),
  ruby: () => import("react-syntax-highlighter/dist/esm/languages/prism/ruby"),
  rust: () => import("react-syntax-highlighter/dist/esm/languages/prism/rust"),
  scss: () => import("react-syntax-highlighter/dist/esm/languages/prism/scss"),
  sql: () => import("react-syntax-highlighter/dist/esm/languages/prism/sql"),
  swift: () => import("react-syntax-highlighter/dist/esm/languages/prism/swift"),
  toml: () => import("react-syntax-highlighter/dist/esm/languages/prism/toml"),
};

const registering = new Map<string, Promise<void>>();

/** True when the grammar is registered (or not lazy-loadable at all). */
export function isLanguageRegistered(language: string): boolean {
  if (!language) return true;
  return registered.has(language) || !(language in LAZY_GRAMMARS);
}

/**
 * Ensure a grammar is registered before rendering a highlighted block.
 * Returns null when nothing needs loading (already registered or unknown);
 * otherwise a promise that resolves once the grammar is available.
 */
export function ensureLanguageRegistered(language: string): Promise<void> | null {
  if (isLanguageRegistered(language)) return null;
  const loader = LAZY_GRAMMARS[language];
  if (!loader) return null;
  let promise = registering.get(language);
  if (!promise) {
    promise = loader()
      .then((module) => {
        PrismLight.registerLanguage(language, module.default);
        registered.add(language);
      })
      .finally(() => registering.delete(language));
    registering.set(language, promise);
  }
  return promise;
}

const PRE_STYLE = 'pre[class*="language-"]';

function withoutPreBackground(theme: Record<string, CSSProperties>) {
  const preStyle = { ...theme[PRE_STYLE] };
  delete preStyle.background;
  delete preStyle.backgroundColor;
  return { ...theme, [PRE_STYLE]: preStyle };
}

const vs = withoutPreBackground(vsTheme);
const vscDarkPlus = withoutPreBackground(vscDarkPlusTheme);

export { createSyntaxElement, vs, vscDarkPlus };
export { PrismLight as SyntaxHighlighter };
